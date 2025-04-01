import fs from 'fs';
import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechService } from '../text_to_speech/service';
import WebSocket from 'ws';

class SpeechToTextService extends ServiceController {
    private ttsService: TextToSpeechService | undefined;
    private readonly WS_SERVER = process.env.WEBSOCKET_SERVER_URL || 'ws://localhost:5001';
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly BUFFER_SIZE = 4800; // 100ms of audio at 48kHz
    private activityId: string;
    private isCollectingSpeech: Map<string, boolean> = new Map();
    private speechBuffer: Map<string, Uint8Array> = new Map();
    private wsConnections: Map<string, WebSocket> = new Map();
    private isProcessing: Map<string, boolean> = new Map();

    constructor(scene: NetworkScene, name = 'SpeechToTextService', activityId: string) {
        super(scene, name);
        this.activityId = activityId;
        console.log(`[SpeechToTextService] Initialized with activity ID: ${this.activityId}`);

        this.registerRoomClientEvents();
        
        // Fix the way we access components
        try {
            this.ttsService = scene.getComponent('TextToSpeechService') as unknown as TextToSpeechService;
            console.log("[SpeechToTextService] Found TextToSpeechService");
        } catch (error) {
            console.error("[SpeechToTextService] ERROR: Could not find TextToSpeechService");
        }
        
        // Log when data is received from child processes
        this.on('data', (data: Buffer, identifier: string) => {
            const response = data.toString().trim();
            
            // Only forward clean transcriptions (starting with '>')
            if (response.startsWith('>')) {
                // Clean transcription without debug info
                const cleanTranscription = response.slice(1).trim();
                console.log(`[SpeechToTextService] Clean transcription: "${cleanTranscription}"`);
                
                // Forward to text generation service
                scene.emit('speechTranscription', {
                    text: cleanTranscription,
                    peerId: identifier
                });
                
                // Also notify the Virtual Assistant component
                scene.emit('transcriptionComplete', {
                    text: cleanTranscription,
                    peerId: identifier
                });
            }
        });

        // Log errors from child processes
        this.on('error', (error: Error, identifier: string) => {
            console.error(`[SpeechToTextService] Error from child process for peer ${identifier}:`, error);
        });
        
        // Log when child processes exit
        this.on('exit', (code: number, identifier: string) => {
            console.log(`[SpeechToTextService] Child process for peer ${identifier} exited with code ${code}`);
        });
    }

    private async connectWebSocket(identifier: string): Promise<void> {
        if (this.wsConnections.has(identifier)) {
            return;
        }

        const ws = new WebSocket(`${this.WS_SERVER}/stt/ws/${identifier}`);
        
        ws.on('open', () => {
            console.log(`[SpeechToTextService] WebSocket connected for peer ${identifier}`);
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
                console.error(`[SpeechToTextService] Error processing WebSocket message:`, error);
            }
        });

        ws.on('close', () => {
            console.log(`[SpeechToTextService] WebSocket closed for peer ${identifier}`);
            this.wsConnections.delete(identifier);
            this.isProcessing.delete(identifier);
        });

        ws.on('error', (error) => {
            console.error(`[SpeechToTextService] WebSocket error for peer ${identifier}:`, error);
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
                console.error(`[SpeechToTextService] WebSocket not ready for peer ${identifier}`);
                return false;
            }

            // Send the audio data
            ws.send(data);
            
            return true;
        } catch (error) {
            console.error('[SpeechToTextService] Error sending data:', error);
            return false;
        }
    }

    startSpeechCollection(identifier: string): void {
        this.isCollectingSpeech.set(identifier, true);
        this.speechBuffer.set(identifier, new Uint8Array(0));
    }

    stopSpeechCollection(identifier: string): void {
        this.isCollectingSpeech.set(identifier, false);
        this.speechBuffer.set(identifier, new Uint8Array(0));
    }

    registerRoomClientEvents(): void {
        if (this.roomClient === undefined) {
            throw new Error('RoomClient must be added to the scene before AudioCollector');
        }

        this.roomClient.addListener('OnPeerAdded', async (peer: { uuid: string }) => {
            this.log(`Starting speech-to-text process for peer ${peer.uuid}`);
            await this.connectWebSocket(peer.uuid);
        });

        this.roomClient.addListener('OnPeerRemoved', (peer: { uuid: string }) => {
            this.log(`Ending speech-to-text process for peer ${peer.uuid}`);
            const ws = this.wsConnections.get(peer.uuid);
            if (ws) {
                ws.close();
                this.wsConnections.delete(peer.uuid);
            }
            this.isProcessing.delete(peer.uuid);
        });
    }
}

export { SpeechToTextService };
