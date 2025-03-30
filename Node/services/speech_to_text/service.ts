import fs from 'fs';
import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechService } from '../text_to_speech/service';
import WebSocket from 'ws';
import { Logger } from '../../components/logger';

class SpeechToTextService extends ServiceController {
    private ttsService: TextToSpeechService | undefined;
    private readonly STT_SERVER = 'http://localhost:5001/stt';
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly BUFFER_SIZE = 4800; // 100ms of audio at 48kHz
    private sceneId: string;
    private isCollectingSpeech: Map<string, boolean> = new Map();
    private speechBuffer: Map<string, Uint8Array> = new Map();
    private wsConnections: Map<string, WebSocket> = new Map();
    private isProcessing: Map<string, boolean> = new Map();

    constructor(scene: NetworkScene, name = 'SpeechToTextService', sceneId: string) {
        super(scene, name);
        this.sceneId = sceneId;
        Logger.log('SpeechToTextService', `Initialized with scene ID: ${this.sceneId}`, 'info');

        this.registerRoomClientEvents();
        
        // Fix the way we access components
        try {
            this.ttsService = scene.getComponent('TextToSpeechService') as unknown as TextToSpeechService;
            Logger.log('SpeechToTextService', "Found TextToSpeechService", 'info');
        } catch (error) {
            Logger.log('SpeechToTextService', "ERROR: Could not find TextToSpeechService", 'error');
        }
        
        // Log when data is received from child processes
        this.on('data', (data: Buffer, identifier: string) => {
            const response = data.toString().trim();
            
            // Only forward clean transcriptions (starting with '>')
            if (response.startsWith('>')) {
                // Clean transcription without debug info
                const cleanTranscription = response.slice(1).trim();
                Logger.log('SpeechToTextService', `Clean transcription: "${cleanTranscription}"`, 'info');
                
                // Forward to text generation service with sceneId
                scene.emit('speechTranscription', {
                    text: cleanTranscription,
                    peerId: identifier,
                    sceneId: this.sceneId
                });
                
                // Also notify the Virtual Assistant component
                scene.emit('transcriptionComplete', {
                    text: cleanTranscription,
                    peerId: identifier,
                    sceneId: this.sceneId
                });
            }
        });

        // Log errors from child processes
        this.on('error', (error: Error, identifier: string) => {
            Logger.log('SpeechToTextService', `Error from child process for peer ${identifier}: ${error}`, 'error');
        });
        
        // Log when child processes exit
        this.on('exit', (code: number, identifier: string) => {
            Logger.log('SpeechToTextService', `Child process for peer ${identifier} exited with code ${code}`, 'info');
        });
    }

    private async connectWebSocket(identifier: string): Promise<void> {
        if (this.wsConnections.has(identifier)) {
            return;
        }

        try {
            // Include sceneId in the WebSocket connection URL for scene-specific processing
            const wsUrl = `ws://localhost:5001/stt/ws/${identifier}?sceneId=${this.sceneId}`;
            Logger.log('SpeechToTextService', `Connecting to WebSocket: ${wsUrl}`, 'info');
            
            const ws = new WebSocket(wsUrl);
            
            ws.on('open', () => {
                Logger.log('SpeechToTextService', `WebSocket connected for peer ${identifier} in scene ${this.sceneId}`, 'info');
                this.wsConnections.set(identifier, ws);
                this.isProcessing.set(identifier, false);
                
                // Get peer name if available
                const peer = this.roomClient?.peers.get(identifier);
                const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                Logger.log('SpeechToTextService', `WebSocket ready for peer ${peerName} (${identifier})`, 'info');
                
                // Send a ping to verify connection is working
                const pingMessage = {
                    type: 'ping',
                    sceneId: this.sceneId,
                    peerId: identifier
                };
                ws.send(JSON.stringify(pingMessage));
            });

            ws.on('message', (data: Buffer) => {
                try {
                    const response = JSON.parse(data.toString());
                    
                    // Log all incoming messages for debugging
                    Logger.log('SpeechToTextService', `WebSocket message from STT server: ${JSON.stringify(response)}`, 'info');
                    
                    if (response.type === 'pong') {
                        Logger.log('SpeechToTextService', `Received pong from STT server for peer ${identifier}`, 'info');
                        return;
                    }
                    
                    if (response.text) {
                        if (response.text !== '[No speech detected]') {
                            // Get peer name if available
                            const peer = this.roomClient?.peers.get(identifier);
                            const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                            Logger.log('SpeechToTextService', `Speech detected from ${peerName}: "${response.text}"`, 'info');
                            
                            this.emit('data', Buffer.from(response.text), identifier);
                        } else {
                            Logger.log('SpeechToTextService', `No speech detected for peer ${identifier}`, 'info');
                        }
                    }
                } catch (error) {
                    Logger.log('SpeechToTextService', `Error processing WebSocket message: ${error}`, 'error');
                }
            });

            ws.on('close', () => {
                Logger.log('SpeechToTextService', `WebSocket closed for peer ${identifier}`, 'info');
                this.wsConnections.delete(identifier);
                this.isProcessing.delete(identifier);
                
                // Try to reconnect after a delay
                setTimeout(() => {
                    if (this.roomClient?.peers.has(identifier)) {
                        Logger.log('SpeechToTextService', `Attempting to reconnect WebSocket for peer ${identifier}`, 'info');
                        this.connectWebSocket(identifier);
                    }
                }, 5000);
            });

            ws.on('error', (error) => {
                Logger.log('SpeechToTextService', `WebSocket error for peer ${identifier}: ${error}`, 'error');
                this.wsConnections.delete(identifier);
                this.isProcessing.delete(identifier);
                
                // Try to reconnect after a delay
                setTimeout(() => {
                    if (this.roomClient?.peers.has(identifier)) {
                        Logger.log('SpeechToTextService', `Attempting to reconnect WebSocket after error for peer ${identifier}`, 'info');
                        this.connectWebSocket(identifier);
                    }
                }, 5000);
            });
        } catch (error) {
            Logger.log('SpeechToTextService', `Error creating WebSocket connection for peer ${identifier}: ${error}`, 'error');
            
            // Try to reconnect after a delay
            setTimeout(() => {
                if (this.roomClient?.peers.has(identifier)) {
                    Logger.log('SpeechToTextService', `Attempting to reconnect WebSocket after connection error for peer ${identifier}`, 'info');
                    this.connectWebSocket(identifier);
                }
            }, 5000);
        }
    }

    async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        try {
            // Only process if we have actual data and we're collecting speech
            if (!data || data.length === 0) {
                return false;
            }
            
            // Log the audio data being processed
            const peer = this.roomClient?.peers.get(identifier);
            const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
            Logger.log('SpeechToTextService', `Processing audio data from ${peerName} (${identifier}): ${data.length} bytes`, 'info');

            // Ensure WebSocket connection exists
            if (!this.wsConnections.has(identifier)) {
                Logger.log('SpeechToTextService', `WebSocket not connected for peer ${identifier}, attempting to connect...`, 'info');
                await this.connectWebSocket(identifier);
                
                // Give it a moment to connect
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const ws = this.wsConnections.get(identifier);
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                Logger.log('SpeechToTextService', `WebSocket not ready for peer ${identifier} (state: ${ws?.readyState})`, 'error');
                
                // Try to reconnect
                this.connectWebSocket(identifier);
                return false;
            }

            // Send the audio data along with scene information
            const audioData = {
                audio: data.toString('base64'),
                sceneId: this.sceneId,
                peerId: identifier,
                peerName: peerName
            };
            
            // Log that we're sending data
            Logger.log('SpeechToTextService', `Sending ${Math.floor(data.length / 1024)} KB of audio data to STT server for ${peerName}`, 'info');
            
            ws.send(JSON.stringify(audioData));
            return true;
        } catch (error) {
            Logger.log('SpeechToTextService', `Error sending data: ${error}`, 'error');
            return false;
        }
    }

    startSpeechCollection(identifier: string): void {
        this.isCollectingSpeech.set(identifier, true);
        this.speechBuffer.set(identifier, new Uint8Array(0));
        Logger.log('SpeechToTextService', `Started speech collection for peer ${identifier} in scene ${this.sceneId}`, 'info');
    }

    stopSpeechCollection(identifier: string): void {
        this.isCollectingSpeech.set(identifier, false);
        this.speechBuffer.set(identifier, new Uint8Array(0));
        Logger.log('SpeechToTextService', `Stopped speech collection for peer ${identifier}`, 'info');
    }

    registerRoomClientEvents(): void {
        if (this.roomClient === undefined) {
            throw new Error('RoomClient must be added to the scene before AudioCollector');
        }

        this.roomClient.addListener('OnPeerAdded', async (peer: { uuid: string }) => {
            Logger.log('SpeechToTextService', `Starting speech-to-text process for peer ${peer.uuid} in scene ${this.sceneId}`, 'info');
            await this.connectWebSocket(peer.uuid);
        });

        this.roomClient.addListener('OnPeerRemoved', (peer: { uuid: string }) => {
            Logger.log('SpeechToTextService', `Ending speech-to-text process for peer ${peer.uuid}`, 'info');
            const ws = this.wsConnections.get(peer.uuid);
            if (ws) {
                ws.close();
                this.wsConnections.delete(peer.uuid);
            }
            this.isProcessing.delete(peer.uuid);
        });
    }
    
    /**
     * Set the room client for this service
     * @param roomClient The room client to use
     */
    setRoomClient(roomClient: any): void {
        this.roomClient = roomClient;
        this.registerRoomClientEvents();
        Logger.log('SpeechToTextService', 'Room client set and events registered', 'info');
    }
    
    /**
     * Clean up resources when this service is no longer needed
     */
    cleanup(): void {
        Logger.log('SpeechToTextService', `Cleaning up service for scene ${this.sceneId}`, 'info');
        
        // Close all WebSocket connections
        this.wsConnections.forEach((ws, identifier) => {
            Logger.log('SpeechToTextService', `Closing WebSocket for peer ${identifier}`, 'info');
            ws.close();
        });
        
        // Clear all collections
        this.wsConnections.clear();
        this.isProcessing.clear();
        this.isCollectingSpeech.clear();
        this.speechBuffer.clear();
        
        // Remove all listeners
        this.removeAllListeners();
        
        Logger.log('SpeechToTextService', 'Cleanup complete', 'info');
    }
}

export { SpeechToTextService };
