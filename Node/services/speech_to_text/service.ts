import fs from 'fs';
import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechService } from '../text_to_speech/service';
import WebSocket from 'ws';

class SpeechToTextService extends ServiceController {
    private audioStats: Map<string, { 
        frames: number, 
        totalBytes: number,
        lastTimestamp: number,
        avgLevel: number
    }> = new Map();
    private originalSendToChildProcess!: (identifier: string, data: Buffer) => Promise<boolean>;

    private ttsService: TextToSpeechService | undefined;
    private readonly STT_SERVER = 'http://localhost:5001/stt';
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private audioBuffer: Map<string, Uint8Array> = new Map();
    private readonly BUFFER_SIZE = 4800; // 100ms of audio at 48kHz
    private activityId: string;

    constructor(scene: NetworkScene, name = 'SpeechToTextService', activityId: string) {
        super(scene, name);
        this.activityId = activityId;
        console.log(`[SpeechToTextService] Initialized with activity ID: ${this.activityId}`);

        this.registerRoomClientEvents();
        this.logAudioConnection();
        
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
    }

    // Direct access to childProcesses for debugging
    private get childProcessList(): string[] {
        return Object.keys(this.childProcesses || {});
    }

    // Register events to create a transcription process for each peer. These processes are killed when the peer leaves the room.
    registerRoomClientEvents(): void {
        if (this.roomClient === undefined) {
            throw new Error('RoomClient must be added to the scene before AudioCollector');
        }

        this.roomClient.addListener('OnPeerAdded', async (peer: { uuid: string }) => {
            this.log(`Starting speech-to-text process for peer ${peer.uuid}`);

            try {
                // Try Python3 explicitly if Python fails
                let pythonCommand = 'python';
                try {
                    const { spawnSync } = await import('child_process');
                    const pythonVersionCmd = spawnSync(pythonCommand, ['--version']);
                    if (pythonVersionCmd.error) {
                        pythonCommand = 'python3';
                        const python3VersionCmd = spawnSync(pythonCommand, ['--version']);
                        if (!python3VersionCmd.error) {
                            console.log(`[SpeechToTextService] Using ${pythonCommand}: ${python3VersionCmd.stdout || python3VersionCmd.stderr}`);
                        } else {
                            throw new Error("Neither 'python' nor 'python3' commands are working");
                        }
                    } else {
                        console.log(`[SpeechToTextService] Using ${pythonCommand}: ${pythonVersionCmd.stdout || pythonVersionCmd.stderr}`);
                    }
                    
                    const processPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcribe_local.py');
                    console.log(`[SpeechToTextService] Launching Python script at: ${processPath}`);
                    
                    console.log(`[SpeechToTextService] Using activity ID: ${this.activityId}`);
                    this.registerChildProcess(peer.uuid, pythonCommand, [
                        '-u',
                        processPath,
                        '--peer', peer.uuid,
                        '--activity_id', this.activityId,
                        '--debug'
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
        this.sendToChildProcess = async (identifier: string, data: Buffer): Promise<boolean> => {
            bytesReceived += data.length;
            
            // Log first few packets
            if (bytesReceived < 10000) {
                console.log(`[SpeechToTextService] Received ${data.length} bytes of audio data`);
            }
            
            console.log('[STT Service] Received audio chunk:', {
                length: data.length,
                firstBytes: Array.from(data.subarray(0, 4)),
                peer: identifier
            });
            
            return this.originalSendToChildProcess(identifier, data);
        };
    }

    async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        try {
            // Add to buffer
            if (!this.audioBuffer.has(identifier)) {
                this.audioBuffer.set(identifier, new Uint8Array(0));
            }
            const buffer = this.audioBuffer.get(identifier)!;
            this.audioBuffer.set(identifier, new Uint8Array([...buffer, ...data]));

            // Send when buffer is full
            if (this.audioBuffer.get(identifier)!.length >= this.BUFFER_SIZE) {
                const audioData = this.audioBuffer.get(identifier)!;
                console.log(`[SpeechToTextService] Sending audio buffer (${audioData.length} bytes) to Python process`);
                
                // Write directly to the Python process's stdin
                const process = this.childProcesses[identifier];
                if (process && process.stdin) {
                    try {
                        process.stdin.write(audioData);
                        console.log(`[SpeechToTextService] Successfully wrote ${audioData.length} bytes to Python process`);
                    } catch (writeError) {
                        console.error(`[SpeechToTextService] Error writing to Python process:`, writeError);
                        return false;
                    }
                } else {
                    console.error(`[SpeechToTextService] No process or stdin available for peer ${identifier}`);
                    return false;
                }
                
                this.audioBuffer.set(identifier, new Uint8Array(0));
            }
            
            return true;
        } catch (error) {
            console.error('[SpeechToTextService] Error sending data:', error);
            return false;
        }
    }
}

export { SpeechToTextService };
