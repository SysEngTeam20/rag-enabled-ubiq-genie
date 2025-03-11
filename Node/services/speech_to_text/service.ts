import fs from 'fs';
import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import path from 'path';
import { fileURLToPath } from 'url';
import { TextToSpeechService } from '../text_to_speech/service';

class SpeechToTextService extends ServiceController {
    private audioStats: Map<string, { 
        frames: number, 
        totalBytes: number,
        lastTimestamp: number,
        avgLevel: number
    }> = new Map();

    private ttsService: TextToSpeechService | undefined;

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
    }

    // Direct access to childProcesses for debugging
    private get childProcessList(): string[] {
        return Object.keys(this.childProcesses || {});
    }

    // Override handleAudioData with explicit process management
    sendToChildProcess(identifier: string, data: Buffer): void {
        // Check if process exists
        if (!this.childProcesses || !this.childProcesses[identifier]) {
            // First attempt: try to create the process if it doesn't exist
            if (!this.childProcesses?.[identifier]) {
                console.log(`[SpeechToTextService] Process not found, attempting to create for peer ${identifier}`);
                try {
                    const processPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcribe_ibm.py');
                    this.registerChildProcess(identifier, 'python', [
                        '-u',
                        processPath,
                        '--peer', identifier,
                        '--debug', 'true'
                    ]);
                    console.log(`[SpeechToTextService] Child processes after creation: ${this.childProcessList.join(', ')}`);
                } catch (error) {
                    console.error(`[SpeechToTextService] Failed to create process on-demand: ${error}`);
                }
            }
            
            // Log error if creation failed
            if (!this.childProcesses?.[identifier]) {
                if (!this.audioStats?.has(identifier) || this.audioStats.get(identifier)?.frames <= 1) {
                    console.error(`[SpeechToTextService] ERROR: Child process for peer ${identifier} not found and couldn't be created. Speech-to-text will not work!`);
                }
                return;
            }
        }
        
        // Process exists, handle audio data
        try {
            super.sendToChildProcess(identifier, data);
        } catch (error) {
            console.error(`[SpeechToTextService] Error sending data to child process: ${error}`);
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
}

export { SpeechToTextService };
