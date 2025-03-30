import { EventEmitter } from 'node:events';
import { PeerConnectionManager } from 'ubiq-server/components/peerconnectionmanager.js';
import { RoomClient } from 'ubiq-server/components/roomclient.js';

// We use the @roamhq/wrtc package as the regular wrtc package has been abandoned :(
import wrtc from '@roamhq/wrtc';
import { RTCAudioData, RTCVideoData } from '@roamhq/wrtc/types/nonstandard';
const { RTCPeerConnection, nonstandard, MediaStream } = wrtc;
const { RTCAudioSink, RTCVideoSink } = nonstandard;
import { Logger } from './logger.js';

interface AudioSink {
    stop: () => void;
    ondata: (data: RTCAudioData) => void;
}

interface VideoSink {
    stop: () => void;
    onframe: (data: RTCVideoData) => void;
}

interface AudioStats {
    samplesReceived: number;
    totalAmplitude: number;
    peakAmplitude: number;
    lastUpdate: number;
}

export class MediaReceiver extends EventEmitter {
  context: any;
    peerConnectionManager!: PeerConnectionManager;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private audioSinks: Map<string, AudioSink> = new Map();
    private videoSinks: Map<string, VideoSink> = new Map();
    private audioStats: Map<string, AudioStats> = new Map();
    private audioLogTimer: NodeJS.Timeout | null = null;
    private readonly AUDIO_LOG_INTERVAL = 2000; // Log every 2 seconds
  private roomClient: RoomClient | null = null;

    /**
     * Create a new MediaReceiver
     * @param scene The NetworkScene to use for peer connections
     * @param roomClient Optional RoomClient to connect with peers in a specific room
     */
    constructor(scene: any, roomClient?: RoomClient) {
    super();
        Logger.log('MediaReceiver', '========== INITIALIZING MEDIA RECEIVER ==========', 'info');
        Logger.log('MediaReceiver', `Scene object valid: ${!!scene}`, 'info');
        
        // Store room client if provided
        if (roomClient) {
            this.roomClient = roomClient;
            Logger.log('MediaReceiver', `RoomClient provided: ${!!roomClient}`, 'info');
            
            // Get room details
            const roomId = (roomClient as any).room?.id || (roomClient as any).roomId;
            Logger.log('MediaReceiver', `RoomClient is for room: ${roomId || 'unknown'}`, 'info');
            
            // Get peer details
            if (roomClient.peers) {
                const peerCount = roomClient.peers.size;
                Logger.log('MediaReceiver', `RoomClient has ${peerCount} peers`, 'info');
                
                // Log each peer
                roomClient.peers.forEach((peer, id) => {
                    const name = peer.properties?.get('ubiq.displayname') || 'Unknown';
                    Logger.log('MediaReceiver', `Peer: ${id}, Name: ${name}`, 'info');
                });
            }
        }
        
        // Check if scene has expected properties
        if (scene) {
            Logger.log('MediaReceiver', `Scene properties: ID=${scene.id || 'undefined'}, Has event methods: ${typeof scene.on === 'function'}`, 'info');
            
            // Check for network components in different possible locations
            const hasNetworkComponents = scene.network !== undefined || 
                                        (scene.networkId !== undefined) || 
                                        (typeof scene.addConnection === 'function');
            
            Logger.log('MediaReceiver', `Scene has network components: ${hasNetworkComponents}`, 'info');
            
            // Check if scene has PeerConnectionManager component
            const hasPCM = scene.network?.getComponent?.("ubiq.connections") !== undefined;
            Logger.log('MediaReceiver', `Scene has PeerConnectionManager component: ${hasPCM}`, 'info');
        }
        
        try {
            // Check for Ubiq PeerConnectionManager
            Logger.log('MediaReceiver', `Attempting to create PeerConnectionManager with scene`, 'info');
            
            // If scene doesn't have needed components, try to add them
            if (typeof scene.addComponent === 'function' && !scene.network?.getComponent?.("ubiq.connections")) {
                Logger.log('MediaReceiver', 'Creating PeerConnectionManager component on scene', 'info');
                
                // Try to directly add the PeerConnectionManager component to the scene
                const pcm = new PeerConnectionManager(scene);
                scene.addComponent("ubiq.connections", pcm);
                Logger.log('MediaReceiver', 'Added PeerConnectionManager to scene', 'info');
            }
            
            this.peerConnectionManager = new PeerConnectionManager(scene);
            Logger.log('MediaReceiver', `PeerConnectionManager created successfully`, 'info');
            
            // Set up a check to help diagnose issues
            setTimeout(() => {
                Logger.log('MediaReceiver', `PeerConnectionManager status check: Has event listeners: ${typeof this.peerConnectionManager.addListener === 'function'}`, 'info');
                Logger.log('MediaReceiver', `Current number of peer connections: ${this.peerConnections.size}`, 'info');
                
                // If we have a roomClient but no peer connections, register for peer events
                if (this.roomClient && this.peerConnections.size === 0) {
                    Logger.log('MediaReceiver', 'No peer connections yet but RoomClient exists, listening for peer events', 'info');
                    
                    // Listen for peer added events
                    this.roomClient.on('OnPeerAdded', (peer: any) => {
                        Logger.log('MediaReceiver', `RoomClient: Peer added: ${peer.id}`, 'info');
                    });
                    
                    // Listen for peer removed events
                    this.roomClient.on('OnPeerRemoved', (peer: any) => {
                        Logger.log('MediaReceiver', `RoomClient: Peer removed: ${peer.id}`, 'info');
                    });
                }
            }, 5000);

            this.peerConnectionManager.addListener('OnPeerConnectionRemoved', (component) => {
                try {
                    if (!component) {
                        Logger.log('MediaReceiver', 'Received null component in OnPeerConnectionRemoved', 'warning');
                        return;
                    }

                    // Clean up peer connection
                    const peerId = component.peerId;
                    if (peerId) {
                        const pc = this.peerConnections.get(peerId);
                        if (pc) {
                            Logger.log('MediaReceiver', `Closing peer connection for peer ${peerId}`, 'info');
                            pc.close();
                            this.peerConnections.delete(peerId);
                        }

                        // Clean up audio sink
                        const audioSink = this.audioSinks.get(peerId);
                        if (audioSink) {
                            Logger.log('MediaReceiver', `Stopping audio sink for peer ${peerId}`, 'info');
                            audioSink.stop();
                            this.audioSinks.delete(peerId);
                        }

                        // Clean up video sink
                        const videoSink = this.videoSinks.get(peerId);
                        if (videoSink) {
                            Logger.log('MediaReceiver', `Stopping video sink for peer ${peerId}`, 'info');
                            videoSink.stop();
                            this.videoSinks.delete(peerId);
                        }
                        
                        // Clean up audio stats
                        this.audioStats.delete(peerId);
                    }

                    // Clean up any elements if they exist
                    if (component.elements && Array.isArray(component.elements)) {
                        for (const element of component.elements) {
                            if (element && typeof element.remove === 'function') {
                                element.remove();
                            }
                        }
                    }
                } catch (error) {
                    Logger.log('MediaReceiver', `Error in OnPeerConnectionRemoved: ${error}`, 'error');
                }
            });

            this.peerConnectionManager.addListener('OnPeerConnection', async (component) => {
                try {
                    if (!component) {
                        Logger.log('MediaReceiver', 'Received null component in OnPeerConnection', 'warning');
                        return;
                    }

                    const peerId = component.peerId;
                    if (!peerId) {
                        Logger.log('MediaReceiver', 'No peer ID in component', 'warning');
                        return;
                    }
                    
                    Logger.log('MediaReceiver', `Creating peer connection for peer ${peerId}`, 'info');

                    let pc = new RTCPeerConnection({
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                            { urls: 'stun:stun2.l.google.com:19302' },
                            { urls: 'stun:stun3.l.google.com:19302' },
                            { urls: 'stun:stun4.l.google.com:19302' }
                        ]
                    });
                    
                    // Log configuration info
                    Logger.log('MediaReceiver', `RTCPeerConnection created with configuration: 
                        iceTransportPolicy: ${pc.getConfiguration().iceTransportPolicy || 'all'},
                        bundlePolicy: ${pc.getConfiguration().bundlePolicy || 'balanced'},
                        iceServers: ${pc.getConfiguration().iceServers?.length || 0} servers`, 'info');

                    this.peerConnections.set(peerId, pc);
                    
                    // Start monitoring connection stats
                    this.startConnectionStats(peerId, pc);
                    
                    // Initialize audio stats for this peer
                    this.audioStats.set(peerId, {
                        samplesReceived: 0,
                        totalAmplitude: 0,
                        peakAmplitude: 0,
                        lastUpdate: Date.now()
                    });

                    // Set up audio handling
                    pc.ontrack = (event) => {
                        Logger.log('MediaReceiver', `Received track from peer ${peerId}: kind=${event.track.kind}, id=${event.track.id}, label=${event.track.label}, readyState=${event.track.readyState}`, 'info');
                        
                        // Log stream info
                        if (event.streams && event.streams.length > 0) {
                            Logger.log('MediaReceiver', `Track belongs to stream: id=${event.streams[0].id}, tracks=${event.streams[0].getTracks().length}`, 'info');
                        } else {
                            Logger.log('MediaReceiver', `Track does not belong to any stream`, 'warning');
                        }
                        
                        if (event.track.kind === 'audio') {
                            Logger.log('MediaReceiver', `Setting up audio sink for track from peer ${peerId}`, 'info');
                            const audioSink = new RTCAudioSink(event.track) as AudioSink;
                            this.audioSinks.set(peerId, audioSink);
                            
                            let packetsReceived = 0;
                            
                            audioSink.ondata = (data: RTCAudioData) => {
                                packetsReceived++;
                                if (packetsReceived === 1 || packetsReceived % 100 === 0) {
                                    Logger.log('MediaReceiver', `Audio packets received from peer ${peerId}: ${packetsReceived}`, 'info');
                                }
                                
                                // Process audio data
                                this.processAudioData(peerId, data);
                                
                                // Emit the audio event
                                this.emit('audio', peerId, data);
                            };
                        } else if (event.track.kind === 'video') {
                            Logger.log('MediaReceiver', `Received video track from peer ${peerId}`, 'info');
                            const videoSink = new RTCVideoSink(event.track) as VideoSink;
                            this.videoSinks.set(peerId, videoSink);
                            
                            videoSink.onframe = (data: RTCVideoData) => {
                                this.emit('video', peerId, data);
                            };
                        }
                    };

                    // Handle ICE candidates
                    pc.onicecandidate = (event) => {
                        if (event.candidate) {
                            Logger.log('MediaReceiver', `Sending ICE candidate for peer ${peerId}`, 'info');
                            component.sendIce(event.candidate);
                        }
                    };

                    // Handle connection state changes
                    pc.onconnectionstatechange = () => {
                        Logger.log('MediaReceiver', `Connection state for peer ${peerId}: ${pc.connectionState}`, 'info');
                        if (pc.connectionState === 'connected') {
                            Logger.log('MediaReceiver', `Peer ${peerId} successfully connected`, 'info');
                        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                            Logger.log('MediaReceiver', `Peer ${peerId} disconnected with state: ${pc.connectionState}`, 'warning');
                        }
                    };
                    
                    // Log any time tracks are added
                    pc.addEventListener('track', (event: RTCTrackEvent) => {
                        Logger.log('MediaReceiver', `Track added for peer ${peerId}: ${event.track.kind}`, 'info');
                    });
                    
                    // Log any time the ice connection state changes
                    pc.oniceconnectionstatechange = () => {
                        Logger.log('MediaReceiver', `ICE connection state for peer ${peerId}: ${pc.iceConnectionState}`, 'info');
                    };

                    // Handle negotiation needed
                    pc.onnegotiationneeded = async () => {
                        try {
                            Logger.log('MediaReceiver', `Negotiation needed for peer ${peerId}`, 'info');
                            const offer = await pc.createOffer();
                            await pc.setLocalDescription(offer);
                            component.sendSdp(offer);
                        } catch (error) {
                            Logger.log('MediaReceiver', `Error creating offer for peer ${peerId}: ${error}`, 'error');
                        }
                    };

                    // Handle incoming SDP
                    component.addListener('OnSdp', async (m: {
                        implementation: any;
                        type: any;
                        sdp: any;
                        candidate: any;
                        sdpMid: any;
                        sdpMLineIndex: any;
                        usernameFragment: any;
                    }) => {
                        try {
                            if (!m || !m.type || !m.sdp) {
                                Logger.log('MediaReceiver', 'Invalid SDP message received', 'warning');
                                return;
                            }

                            const description = {
                                type: m.type,
                                sdp: m.sdp
                            };
                            
                            Logger.log('MediaReceiver', `Received SDP ${m.type} from peer ${peerId}`, 'info');

                            const readyForOffer =
                                !component.makingOffer &&
                                (pc.signalingState === 'stable' || component.isSettingRemoteAnswerPending);
                            const offerCollision = description.type === 'offer' && !readyForOffer;

                            component.ignoreOffer = !component.polite && offerCollision;
                            if (component.ignoreOffer) {
                                Logger.log('MediaReceiver', `Ignoring offer due to collision for peer ${peerId}`, 'info');
                                return;
                            }

                            component.isSettingRemoteAnswerPending = description.type === 'answer';
                            await pc.setRemoteDescription(description);
                            component.isSettingRemoteAnswerPending = false;
                            
                            Logger.log('MediaReceiver', `Set remote description ${m.type} for peer ${peerId}`, 'info');

                            if (description.type === 'offer') {
                                Logger.log('MediaReceiver', `Creating answer for peer ${peerId}`, 'info');
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                                component.sendSdp(answer);
                            } else if (description.type === 'answer') {
                                if (!component.hasRenegotiated) {
                                    component.hasRenegotiated = true;
                                    setTimeout(async () => {
                                        try {
                                            Logger.log('MediaReceiver', `Renegotiating with peer ${peerId}`, 'info');
                                            const offer = await pc.createOffer();
                                            await pc.setLocalDescription(offer);
                                            component.sendSdp(offer);
                                        } catch (error) {
                                            Logger.log('MediaReceiver', `Error in renegotiation for peer ${peerId}: ${error}`, 'error');
                                        }
                                    }, 1000);
                                }
                            }
                        } catch (error) {
                            Logger.log('MediaReceiver', `Error handling SDP for peer ${peerId}: ${error}`, 'error');
                        }
                    });

                    // Handle ICE candidates
                    component.addListener('OnIce', async (m: {
                        candidate: any;
                        sdpMid: any;
                        sdpMLineIndex: any;
                        usernameFragment: any;
                    }) => {
                        try {
                            if (!m || !m.candidate) {
                                Logger.log('MediaReceiver', 'Invalid ICE candidate received', 'warning');
                                return;
                            }
                            
                            Logger.log('MediaReceiver', `Received ICE candidate for peer ${peerId}`, 'info');
                            await pc.addIceCandidate(m.candidate);
                        } catch (error) {
                            Logger.log('MediaReceiver', `Error adding ICE candidate for peer ${peerId}: ${error}`, 'error');
                        }
                    });

                } catch (error) {
                    Logger.log('MediaReceiver', `Error in OnPeerConnection: ${error}`, 'error');
                }
            });
            
            Logger.log('MediaReceiver', 'MediaReceiver initialized successfully', 'info');
        } catch (error) {
            Logger.log('MediaReceiver', `ERROR creating PeerConnectionManager: ${error}`, 'error');
            
            // Handle the case where PeerConnectionManager creation fails
            if (scene && typeof scene.on === 'function') {
                // Try to listen directly to the scene's events as fallback
                Logger.log('MediaReceiver', `Attempting to listen directly to scene events as fallback`, 'info');
                scene.on('OnPeerConnectionAdded', (component: any) => {
                    Logger.log('MediaReceiver', `Received OnPeerConnectionAdded from scene: ${component?.peerId || 'unknown'}`, 'info');
                });
            }
        }
    }
    
    public start() {
        Logger.log('MediaReceiver', 'Starting MediaReceiver', 'info');
        
        if (this.audioLogTimer === null) {
            this.audioLogTimer = setInterval(() => this.logAudioStats(), this.AUDIO_LOG_INTERVAL);
        }
        
        // Check if we need to create mock audio tracks for testing
        if (this.peerConnections.size === 0) {
            Logger.log('MediaReceiver', 'No peer connections detected, will retry connection in 5 seconds', 'info');
            
            // Try to detect peer connections in 5 seconds
            setTimeout(() => {
                if (this.peerConnections.size === 0) {
                    Logger.log('MediaReceiver', 'Still no peer connections. Check if WebRTC is properly configured', 'warning');
                    
                    // Try to diagnose the issue
                    this.diagnosePeerConnectionStatus();
                }
            }, 5000);
        }
    }

    public stop() {
        Logger.log('MediaReceiver', 'Stopping MediaReceiver', 'info');
        
        if (this.audioLogTimer !== null) {
            clearInterval(this.audioLogTimer);
            this.audioLogTimer = null;
        }
    }
    
    private logAudioStats() {
        if (this.audioStats.size === 0) {
            Logger.log('MediaReceiver', 'No audio statistics available - no audio may be flowing', 'info');
            return;
        }
        
        for (const [peerId, stats] of this.audioStats.entries()) {
            const avgAmplitude = stats.samplesReceived > 0 ? stats.totalAmplitude / stats.samplesReceived : 0;
            
            Logger.log('MediaReceiver', 
                `Audio stats for peer ${peerId}: Samples: ${stats.samplesReceived}, ` +
                `Avg amplitude: ${avgAmplitude.toFixed(2)}, Peak amplitude: ${stats.peakAmplitude.toFixed(2)}`, 
                'info');
            
            // Reset stats after logging
            stats.samplesReceived = 0;
            stats.totalAmplitude = 0;
            stats.peakAmplitude = 0;
            stats.lastUpdate = Date.now();
        }
    }

    /**
     * Process audio data for logging and analysis
     */
    private processAudioData(peerId: string, data: RTCAudioData): void {
        // Check if data is valid
        if (!data || !data.samples || data.samples.length === 0) {
            Logger.log('MediaReceiver', `Received invalid audio data from peer ${peerId}`, 'warning');
      return;
    }
    
        // Always log at least some basic info about receiving audio data
        Logger.log('MediaReceiver', `Received audio data from peer ${peerId}: ${data.samples.length} samples, channels: ${data.channelCount}, sampleRate: ${data.sampleRate}Hz`, 'info');
        
        const stats = this.audioStats.get(peerId);
        if (!stats) return;
        
        // Calculate average amplitude
        let sum = 0;
        let peak = 0;
        let nonZeroSamples = 0;
        
        try {
            // Safely process audio data
            for (let i = 0; i < data.samples.length; i++) {
                if (typeof data.samples[i] === 'number') {
                    const abs = Math.abs(data.samples[i]);
                    sum += abs;
                    peak = Math.max(peak, abs);
                    if (abs > 0.001) nonZeroSamples++;
                }
            }
            
            // Now check if we calculated anything useful
            if (data.samples.length > 0) {
                // Always log details for debugging
                const percentActive = (nonZeroSamples / data.samples.length * 100).toFixed(1);
                Logger.log('MediaReceiver', 
                    `Audio packet: peer=${peerId}, channels=${data.channelCount}, samples=${data.samples.length}, ` +
                    `sampleRate=${data.sampleRate}Hz, nonZero=${nonZeroSamples} (${percentActive}%), peak=${peak.toFixed(3)}`, 
                    'info');
                
                // Update stats
                stats.samplesReceived += data.samples.length;
                stats.totalAmplitude += sum;
                stats.peakAmplitude = Math.max(stats.peakAmplitude, peak);
                
                // Log periodically
                const now = Date.now();
                if (now - stats.lastUpdate > this.AUDIO_LOG_INTERVAL) {
                    const avgAmplitude = stats.totalAmplitude / stats.samplesReceived;
                    Logger.log('MediaReceiver', `[AUDIO DATA] Peer ${peerId}: samples=${stats.samplesReceived}, avg=${avgAmplitude.toFixed(2)}, peak=${stats.peakAmplitude.toFixed(2)}`, 'info');
                    Logger.log('MediaReceiver', `[AUDIO CHUNK] Peer ${peerId}: channels=${data.channelCount}, samples=${data.samples.length}, sampleRate=${data.sampleRate}Hz`, 'info');
                    
                    // Reset stats
                    stats.lastUpdate = now;
                    stats.samplesReceived = 0;
                    stats.totalAmplitude = 0;
                    stats.peakAmplitude = 0;
                }
            }
        } catch (error) {
            Logger.log('MediaReceiver', `Error processing audio data: ${error}`, 'error');
        }
    }

    private startConnectionStats(peerId: string, pc: RTCPeerConnection): void {
        // Monitor connection statistics every 5 seconds
        const interval = setInterval(async () => {
            if (!this.peerConnections.has(peerId)) {
                clearInterval(interval);
                return;
            }

            try {
                const stats = await pc.getStats();
                let audioReceived = false;
                let bytesReceived = 0;
                let packetsReceived = 0;
                let packetsLost = 0;
                
                stats.forEach(report => {
                    // Log only specific report types to avoid flooding
                    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
                        audioReceived = true;
                        bytesReceived = report.bytesReceived || 0;
                        packetsReceived = report.packetsReceived || 0;
                        packetsLost = report.packetsLost || 0;
                        
                        Logger.log('MediaReceiver', 
                            `RTC Stats for peer ${peerId}: Audio received=${bytesReceived} bytes, ` +
                            `packets=${packetsReceived}, lost=${packetsLost}, ` +
                            `loss=${packetsReceived > 0 ? (packetsLost / packetsReceived * 100).toFixed(1) : 0}%`, 
                            'info');
                    }
                    else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        Logger.log('MediaReceiver', 
                            `ICE connection for peer ${peerId}: ` +
                            `Round trip time=${report.currentRoundTripTime ? (report.currentRoundTripTime * 1000).toFixed(1) + 'ms' : 'N/A'}, ` +
                            `available outgoing=${report.availableOutgoingBitrate ? (report.availableOutgoingBitrate / 1000).toFixed(0) + 'kbps' : 'N/A'}, ` +
                            `available incoming=${report.availableIncomingBitrate ? (report.availableIncomingBitrate / 1000).toFixed(0) + 'kbps' : 'N/A'}`,
                            'info');
                    }
                });
                
                if (!audioReceived) {
                    Logger.log('MediaReceiver', `No audio data being received from peer ${peerId}`, 'warning');
                }
            } catch (error) {
                Logger.log('MediaReceiver', `Error getting connection stats for peer ${peerId}: ${error}`, 'error');
            }
        }, 5000);
    }

    /**
     * Diagnose and log WebRTC peer connection status
     */
    private diagnosePeerConnectionStatus(): void {
        try {
            Logger.log('MediaReceiver', '===== DIAGNOSING PEER CONNECTION STATUS =====', 'info');
            
            // Check if PeerConnectionManager is working
            if (!this.peerConnectionManager) {
                Logger.log('MediaReceiver', 'PeerConnectionManager is not initialized', 'error');
        return;
      }
      
            // Check if events are registered
            const hasListeners = typeof this.peerConnectionManager.addListener === 'function';
            Logger.log('MediaReceiver', `PeerConnectionManager has listeners: ${hasListeners}`, 'info');
            
            // Log important WebRTC information
            Logger.log('MediaReceiver', `RTCPeerConnection implementation available: ${typeof RTCPeerConnection !== 'undefined'}`, 'info');
            Logger.log('MediaReceiver', `RTCAudioSink implementation available: ${typeof RTCAudioSink !== 'undefined'}`, 'info');
            
            // Force a check for event registration by trying to send a test event
            if (hasListeners) {
                try {
                    Logger.log('MediaReceiver', 'Checking for other event methods', 'info');
                    // Use type assertion to check if dispatchEvent exists
                    const pcmAny = this.peerConnectionManager as any;
                    const hasDispatch = typeof pcmAny.dispatchEvent === 'function';
                    const hasEmit = typeof pcmAny.emit === 'function';
                    
                    Logger.log('MediaReceiver', `PeerConnectionManager has dispatchEvent: ${hasDispatch}, has emit: ${hasEmit}`, 'info');
                    
                    // Try to use an available method to dispatch a test event
                    if (hasDispatch) {
                        pcmAny.dispatchEvent('TestEvent', { test: true });
                        Logger.log('MediaReceiver', 'Successfully dispatched test event', 'info');
                    } else if (hasEmit) {
                        pcmAny.emit('TestEvent', { test: true });
                        Logger.log('MediaReceiver', 'Successfully emitted test event', 'info');
      }
    } catch (error) {
                    Logger.log('MediaReceiver', `Error testing events: ${error}`, 'error');
                }
            }
            
            Logger.log('MediaReceiver', '===== PEER CONNECTION DIAGNOSIS COMPLETE =====', 'info');
        } catch (error) {
            Logger.log('MediaReceiver', `Error in peer connection diagnosis: ${error}`, 'error');
        }
    }
}
