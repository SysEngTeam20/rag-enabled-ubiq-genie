import fs from 'fs';
import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechService } from '../text_to_speech/service';
import fetch from 'node-fetch';
import FormData from 'form-data';
import WebSocket from 'ws';

class SpeechToTextService extends ServiceController {
    private audioStats: Map<string, { 
        frames: number, 
        totalBytes: number,
        lastTimestamp: number,
        avgLevel: number
    }> = new Map();

    private ttsService: TextToSpeechService | undefined;
    private readonly STT_SERVER = 'http://localhost:5001/stt';
    private wsConnection: WebSocket | null = null;
    private readonly WS_SERVER = 'ws://localhost:5001/stt/ws';
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;

    constructor(scene: NetworkScene, name = 'SpeechToTextService') {
        super(scene, name);

        this.registerRoomClientEvents();
        this.logAudioConnection();
        
        // Fix the way we access components
        try {
            this.ttsService = scene.getComponent(TextToSpeechService) as TextToSpeechService;
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
            } else if (response.startsWith('[IBM]')) {
                // Just log Watson API messages, don't forward them
                console.log(`[SpeechToTextService] Watson API: ${response}`);
            } else if (response.startsWith('[DEBUG]')) {
                // Just log debug messages, don't forward them
                console.log(`[SpeechToTextService] Python debug: ${response}`);
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

        this.setupWebSocket();
    }

    // Direct access to childProcesses for debugging
    private get childProcessList(): string[] {
        return Object.keys(this.childProcesses || {});
    }

    private setupWebSocket() {
        try {
            const clientId = Math.random().toString(36).substring(7);
            this.wsConnection = new WebSocket(`${this.WS_SERVER}/${clientId}`);

            this.wsConnection.on('open', () => {
                console.log('[SpeechToTextService] WebSocket connected');
                this.reconnectAttempts = 0;
            });

            this.wsConnection.on('message', (data: WebSocket.Data) => {
                try {
                    const result = JSON.parse(data.toString());
                    if (result.text) {
                        this.emit('data', Buffer.from(`>${result.text}`), 'default');
                    }
                } catch (error) {
                    console.error('[SpeechToTextService] Error parsing WebSocket message:', error);
                }
            });

            this.wsConnection.on('close', () => {
                console.log('[SpeechToTextService] WebSocket closed');
                this.attemptReconnect();
            });

            this.wsConnection.on('error', (error) => {
                console.error('[SpeechToTextService] WebSocket error:', error);
                this.attemptReconnect();
            });

        } catch (error) {
            console.error('[SpeechToTextService] Error setting up WebSocket:', error);
        }
    }

    private attemptReconnect() {
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`[SpeechToTextService] Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => this.setupWebSocket(), 1000 * this.reconnectAttempts);
        }
    }

    // Register events to create a transcription process for each peer. These processes are killed when the peer leaves the room.
    registerRoomClientEvents(): void {
        if (this.roomClient === undefined) {
            throw new Error('RoomClient must be added to the scene before AudioCollector');
        }

        this.roomClient.addListener('OnPeerAdded', (peer: { uuid: string }) => {
            this.log(`Starting speech-to-text process for peer ${peer.uuid}`);

            try {
                // Try Python3 explicitly if Python fails
                let pythonCommand = 'python';
                try {
                    const pythonVersionCmd = require('child_process').spawnSync(pythonCommand, ['--version']);
                    if (pythonVersionCmd.error) {
                        pythonCommand = 'python3';
                        const python3VersionCmd = require('child_process').spawnSync(pythonCommand, ['--version']);
                        if (!python3VersionCmd.error) {
                            console.log(`[SpeechToTextService] Using ${pythonCommand}: ${python3VersionCmd.stdout || python3VersionCmd.stderr}`);
                        } else {
                            throw new Error("Neither 'python' nor 'python3' commands are working");
                        }
                    } else {
                        console.log(`[SpeechToTextService] Using ${pythonCommand}: ${pythonVersionCmd.stdout || pythonVersionCmd.stderr}`);
                    }
                    
                    const processPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcribe_ibm.py');
                    console.log(`[SpeechToTextService] Launching Python script at: ${processPath}`);
                    
                    this.registerChildProcess(peer.uuid, pythonCommand, [
                        '-u',
                        processPath,
                        '--peer', peer.uuid,
                        '--debug', 'true'
                    ]);
                    
                    // Directly check if process was created
                    console.log(`[SpeechToTextService] Child processes: ${Object.keys(this.childProcesses || {}).join(', ')}`);
                    
                } catch (error) {
                    console.error(`[SpeechToTextService] Error starting Python process: ${error}`);
                }
            } catch (error) {
                console.error(`[SpeechToTextService] Failed to start process for peer ${peer.uuid}:`, error);
            }
        });

        this.roomClient.addListener('OnPeerRemoved', (peer: { uuid: string }) => {
            this.log(`Ending speech-to-text process for peer ${peer.uuid}`);
            try {
                this.killChildProcess(peer.uuid);
                console.log(`[SpeechToTextService] Child process terminated for peer ${peer.uuid}`);
                
                // Clean up stats
                this.audioStats.delete(peer.uuid);
            } catch (error) {
                console.error(`[SpeechToTextService] Error killing child process for peer ${peer.uuid}:`, error);
            }
        });
    }

    // Add this method to log when audio data comes in from Unity
    private logAudioConnection() {
        // Check if we're receiving any data at all from Unity
        let lastLogTime = Date.now();
        let bytesReceived = 0;
        
        // Set interval to check audio data flow
        setInterval(() => {
            console.log(`[SpeechToTextService] Audio status: ${bytesReceived} bytes received in last 5 seconds`);
            bytesReceived = 0;
            lastLogTime = Date.now();
        }, 5000);
        
        // Add this at the beginning of sendToChildProcess before other code
        this.originalSendToChildProcess = this.sendToChildProcess;
        this.sendToChildProcess = (identifier: string, data: Buffer) => {
            bytesReceived += data.length;
            
            // Log first few packets
            if (bytesReceived < 10000) {
                console.log(`[SpeechToTextService] Received ${data.length} bytes of audio data from Unity`);
                // Log first 10 bytes to see what's in the data
                if (data.length > 0) {
                    console.log(`[SpeechToTextService] First 10 bytes: ${Buffer.from(data.slice(0, 10)).toString('hex')}`);
                }
            }
            
            this.originalSendToChildProcess(identifier, data);
        };
    }

    async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            console.error('[SpeechToTextService] WebSocket not connected');
            return false;
        }

        try {
            this.wsConnection.send(data);
            return true;
        } catch (error) {
            console.error('[SpeechToTextService] Error sending data:', error);
            return false;
        }
    }
}

export { SpeechToTextService };
