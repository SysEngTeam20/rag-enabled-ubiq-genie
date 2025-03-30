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

        // Include sceneId in the WebSocket connection URL for scene-specific processing
        const ws = new WebSocket(`ws://localhost:5001/stt/ws/${identifier}?sceneId=${this.sceneId}`);
        
        ws.on('open', () => {
            Logger.log('SpeechToTextService', `WebSocket connected for peer ${identifier} in scene ${this.sceneId}`, 'info');
            this.wsConnections.set(identifier, ws);
            this.isProcessing.set(identifier, false);
        });

        ws.on('message', (data: Buffer) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.text && response.text !== '[No speech detected]') {
                    this.emit('data', Buffer.from(response.text), identifier);
                }
            } catch (error) {
                Logger.log('SpeechToTextService', `Error processing WebSocket message: ${error}`, 'error');
            }
        });

        ws.on('close', () => {
            Logger.log('SpeechToTextService', `WebSocket closed for peer ${identifier}`, 'info');
            this.wsConnections.delete(identifier);
            this.isProcessing.delete(identifier);
        });

        ws.on('error', (error) => {
            Logger.log('SpeechToTextService', `WebSocket error for peer ${identifier}: ${error}`, 'error');
            this.wsConnections.delete(identifier);
            this.isProcessing.delete(identifier);
        });
    }

    async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        try {
            // Only process if we have actual data and we're collecting speech
            if (!data || data.length === 0 || !this.isCollectingSpeech.get(identifier)) {
                return false;
            }

            // Ensure WebSocket connection exists
            if (!this.wsConnections.has(identifier)) {
                await this.connectWebSocket(identifier);
            }

            const ws = this.wsConnections.get(identifier);
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                Logger.log('SpeechToTextService', `WebSocket not ready for peer ${identifier}`, 'error');
                return false;
            }

            // Send the audio data along with scene information
            const audioData = {
                audio: data.toString('base64'),
                sceneId: this.sceneId,
                peerId: identifier
            };
            
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
