import { EventEmitter } from 'node:events';
import { PeerConnectionManager } from 'ubiq-server/components/peerconnectionmanager.js';

// We use the @roamhq/wrtc package as the regular wrtc package has been abandoned :(
import wrtc from '@roamhq/wrtc';
import { RTCAudioData, RTCVideoData } from '@roamhq/wrtc/types/nonstandard';
const { RTCPeerConnection, nonstandard, MediaStream } = wrtc;
const { RTCAudioSink, RTCVideoSink } = nonstandard;

interface AudioSink {
    stop: () => void;
    ondata: (data: RTCAudioData) => void;
}

interface VideoSink {
    stop: () => void;
    onframe: (data: RTCVideoData) => void;
}

export class MediaReceiver extends EventEmitter {
    context: any;
    peerConnectionManager: PeerConnectionManager;
    private peerConnections: Map<string, RTCPeerConnection> = new Map();
    private audioSinks: Map<string, AudioSink> = new Map();
    private videoSinks: Map<string, VideoSink> = new Map();

    constructor(scene: any) {
        super();
        this.peerConnectionManager = new PeerConnectionManager(scene);

        this.peerConnectionManager.addListener('OnPeerConnectionRemoved', (component) => {
            try {
                if (!component) {
                    console.warn('[MediaReceiver] Received null component in OnPeerConnectionRemoved');
                    return;
                }

                // Clean up peer connection
                const peerId = component.peerId;
                if (peerId) {
                    const pc = this.peerConnections.get(peerId);
                    if (pc) {
                        pc.close();
                        this.peerConnections.delete(peerId);
                    }

                    // Clean up audio sink
                    const audioSink = this.audioSinks.get(peerId);
                    if (audioSink) {
                        audioSink.stop();
                        this.audioSinks.delete(peerId);
                    }

                    // Clean up video sink
                    const videoSink = this.videoSinks.get(peerId);
                    if (videoSink) {
                        videoSink.stop();
                        this.videoSinks.delete(peerId);
                    }
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
                console.error('[MediaReceiver] Error in OnPeerConnectionRemoved:', error);
            }
        });

        this.peerConnectionManager.addListener('OnPeerConnection', async (component) => {
            try {
                if (!component) {
                    console.warn('[MediaReceiver] Received null component in OnPeerConnection');
                    return;
                }

                const peerId = component.peerId;
                if (!peerId) {
                    console.warn('[MediaReceiver] No peer ID in component');
                    return;
                }

                let pc = new RTCPeerConnection({
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' }
                    ]
                });

                this.peerConnections.set(peerId, pc);

                // Set up audio handling
                pc.ontrack = (event) => {
                    if (event.track.kind === 'audio') {
                        const audioSink = new RTCAudioSink(event.track) as AudioSink;
                        this.audioSinks.set(peerId, audioSink);
                        
                        audioSink.ondata = (data: RTCAudioData) => {
                            this.emit('audio', peerId, data);
                        };
                    } else if (event.track.kind === 'video') {
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
                        component.sendIce(event.candidate);
                    }
                };

                // Handle connection state changes
                pc.onconnectionstatechange = () => {
                    console.log(`[MediaReceiver] Connection state for peer ${peerId}: ${pc.connectionState}`);
                };

                // Handle negotiation needed
                pc.onnegotiationneeded = async () => {
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        component.sendSdp(offer);
                    } catch (error) {
                        console.error(`[MediaReceiver] Error creating offer for peer ${peerId}:`, error);
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
                            console.warn('[MediaReceiver] Invalid SDP message received');
                            return;
                        }

                        const description = {
                            type: m.type,
                            sdp: m.sdp
                        };

                        const readyForOffer =
                            !component.makingOffer &&
                            (pc.signalingState === 'stable' || component.isSettingRemoteAnswerPending);
                        const offerCollision = description.type === 'offer' && !readyForOffer;

                        component.ignoreOffer = !component.polite && offerCollision;
                        if (component.ignoreOffer) {
                            return;
                        }

                        component.isSettingRemoteAnswerPending = description.type === 'answer';
                        await pc.setRemoteDescription(description);
                        component.isSettingRemoteAnswerPending = false;

                        if (description.type === 'offer') {
                            const answer = await pc.createAnswer();
                            await pc.setLocalDescription(answer);
                            component.sendSdp(answer);
                        } else if (description.type === 'answer') {
                            if (!component.hasRenegotiated) {
                                component.hasRenegotiated = true;
                                setTimeout(async () => {
                                    try {
                                        const offer = await pc.createOffer();
                                        await pc.setLocalDescription(offer);
                                        component.sendSdp(offer);
                                    } catch (error) {
                                        console.error(`[MediaReceiver] Error in renegotiation for peer ${peerId}:`, error);
                                    }
                                }, 1000);
                            }
                        }
                    } catch (error) {
                        console.error(`[MediaReceiver] Error handling SDP for peer ${peerId}:`, error);
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
                            console.warn('[MediaReceiver] Invalid ICE candidate received');
                            return;
                        }

                        await pc.addIceCandidate(m.candidate);
                    } catch (error) {
                        console.error(`[MediaReceiver] Error adding ICE candidate for peer ${peerId}:`, error);
                    }
                });

            } catch (error) {
                console.error('[MediaReceiver] Error in OnPeerConnection:', error);
            }
        });
    }
}
