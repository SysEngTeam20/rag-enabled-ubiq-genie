import { NetworkId } from 'ubiq';
import { ApplicationController } from '../../components/application';
import { TextToSpeechService } from '../../services/text_to_speech/service';
import { SpeechToTextService } from '../../services/speech_to_text/service';
import { TextGenerationService } from '../../services/text_generation/service';
import { MediaReceiver } from '../../components/media_receiver';
import path from 'path';
import { RTCAudioData } from '@roamhq/wrtc/types/nonstandard';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nconf from 'nconf';

export class ConversationalAgent extends ApplicationController {
    components: {
        mediaReceiver?: MediaReceiver;
        speech2text?: SpeechToTextService;
        textGenerationService?: TextGenerationService;
        textToSpeechService?: TextToSpeechService;
    } = {};
    targetPeer: string = '';
    private activityId: string;
    private readonly SPEECH_THRESHOLD = 1000; // Threshold for speech detection
    private readonly MIN_SPEECH_DURATION = 0.1; // Minimum duration of speech in seconds
    private speechBuffer: Map<string, { buffer: Uint8Array, startTime: number, isSpeaking: boolean }> = new Map();

    constructor(configFile: string = 'config.json') {
        console.log('[ConversationalAgent] Initializing with config file:', configFile);
        super(configFile);
        
        // Load .env.local from project root
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Get activityId from environment variable with a default value
        this.activityId = process.env.ACTIVITY_ID || '5d2f8b7b-f1bf-4f8f-8f39-85649045fd45';
        this.log(`Initializing Conversational Agent for activity: ${this.activityId}`);
    }

    start(): void {
        console.log('[ConversationalAgent] Starting application...');
        
        // STEP 1: Register services (and any other components) used by the application
        this.registerComponents();
        console.log(`[ConversationalAgent] Services registered: ${Object.keys(this.components).join(', ')}`);

        // STEP 2: Define the application pipeline
        this.definePipeline();
        console.log('[ConversationalAgent] Pipeline defined');

        // STEP 3: Join a room based on the configuration (optionally creates a server)
        try {
            // Set a specific room name if not configured
            const roomName = nconf.get('roomname') || 'ai-agent-room';
            nconf.set('roomname', roomName);
            
            this.joinRoom();
            console.log('[ConversationalAgent] Room configuration:', {
                roomName: nconf.get('roomname'),
                roomServer: nconf.get('roomserver'),
                peerUUID: this.roomClient?.peer?.uuid
            });
            
            // Monitor room join status
            if (!this.roomClient) {
                throw new Error('[ConversationalAgent] Room client not initialized');
            }

            this.roomClient.addListener('OnJoinedRoom', (room: any) => {
                console.log('[ConversationalAgent] Successfully joined room:', {
                    roomName: nconf.get('roomname'),
                    peers: Array.from(this.roomClient.peers.keys())
                });
            });
        } catch (error) {
            console.error('[ConversationalAgent] Failed to join room:', error);
            throw error; // Re-throw to prevent silent failures
        }
    }

    registerComponents() {
        try {
            // An MediaReceiver to receive audio data from peers
            this.components.mediaReceiver = new MediaReceiver(this.scene);
            console.log('[ConversationalAgent] MediaReceiver initialized');

            // A SpeechToTextService to transcribe audio coming from peers
            this.components.speech2text = new SpeechToTextService(this.scene);
            console.log('[ConversationalAgent] SpeechToTextService initialized');

            // A TextGenerationService to generate text based on text
            try {
                this.components.textGenerationService = new TextGenerationService(this.scene, this.activityId);
                console.log('[ConversationalAgent] TextGenerationService initialized');
            } catch (error) {
                console.error('[ConversationalAgent] Failed to initialize TextGenerationService:', error);
                // Continue without text generation - we can still test audio
            }

            // A TextToSpeechService to generate audio based on text
            this.components.textToSpeechService = new TextToSpeechService(this.scene);
            console.log('[ConversationalAgent] TextToSpeechService initialized');

        } catch (error) {
            console.error('[ConversationalAgent] Error during component registration:', error);
            throw error;
        }
    }

    definePipeline() {
        console.log('[ConversationalAgent] Setting up audio pipeline...');
        
        if (!this.components.mediaReceiver) {
            console.error('[ConversationalAgent] MediaReceiver not initialized!');
            return;
        }

        // Log all available components
        console.log('[ConversationalAgent] Available components:', {
            mediaReceiver: !!this.components.mediaReceiver,
            speech2text: !!this.components.speech2text,
            textGeneration: !!this.components.textGenerationService,
            tts: !!this.components.textToSpeechService
        });

        this.components.mediaReceiver.on('audio', (uuid: string, data: RTCAudioData) => {
            if (!this.roomClient.peers.get(uuid)) {
                return;
            }

            // Convert audio data to buffer
            const sampleBuffer = Buffer.from(data.samples.buffer);
            
            // Calculate audio level
            let sum = 0;
            for (let i = 0; i < data.samples.length; i++) {
                sum += Math.abs(data.samples[i]);
            }
            const avgLevel = sum / data.samples.length;

            // Initialize speech buffer for this peer if not exists
            if (!this.speechBuffer.has(uuid)) {
                this.speechBuffer.set(uuid, {
                    buffer: new Uint8Array(0),
                    startTime: Date.now(),
                    isSpeaking: false
                });
            }

            const speechState = this.speechBuffer.get(uuid)!;

            // Check if this is speech
            if (avgLevel > this.SPEECH_THRESHOLD) {
                if (!speechState.isSpeaking) {
                    console.log(`[MediaReceiver] Speech detected from peer ${uuid}, level: ${avgLevel.toFixed(2)}`);
                    speechState.isSpeaking = true;
                    speechState.startTime = Date.now();
                }
                speechState.buffer = new Uint8Array([...speechState.buffer, ...sampleBuffer]);
            } else {
                if (speechState.isSpeaking) {
                    // Check if we've been speaking long enough
                    const duration = (Date.now() - speechState.startTime) / 1000;
                    if (duration >= this.MIN_SPEECH_DURATION) {
                        console.log(`[MediaReceiver] Sending speech buffer to STT, duration: ${duration.toFixed(2)}s`);
                        this.components.speech2text?.sendToChildProcess(uuid, Buffer.from(speechState.buffer));
                    } else {
                        console.log(`[MediaReceiver] Speech too short, dropping (${duration.toFixed(2)}s)`);
                    }
                    speechState.isSpeaking = false;
                    speechState.buffer = new Uint8Array(0);
                }
            }
        });

        // Monitor room events
        this.roomClient.addListener('OnPeerAdded', (peer: { uuid: string }) => {
            console.log(`[ConversationalAgent] New peer connected:`, {
                uuid: peer.uuid,
                timestamp: new Date().toISOString()
            });
        });

        this.roomClient.addListener('OnPeerRemoved', (peer: { uuid: string }) => {
            console.log(`[ConversationalAgent] Peer disconnected:`, {
                uuid: peer.uuid,
                timestamp: new Date().toISOString()
            });
        });

        // Step 2: When we receive a response from the transcription service, we send it to the text generation service
        this.components.speech2text?.on('data', (data: Buffer, identifier: string) => {
            const peer = this.roomClient.peers.get(identifier);
            const peerName = peer?.properties.get('ubiq.displayname') || 'User';
            let response = data.toString().replace(/(\r\n|\n|\r)/gm, '');
            
            if (response.startsWith('>')) {
                response = response.slice(1);
                if (response.trim()) {
                    const message = (peerName + ' -> Agent:: ' + response).trim();
                    this.log(message);

                    // Pass activityId with each message
                    console.log('[ConversationalAgent] Sending to text generation:', {
                        message,
                        activityId: this.activityId,
                        hasService: !!this.components.textGenerationService,
                        serviceState: {
                            pid: this.components.textGenerationService?.childProcesses['default']?.pid,
                            killed: this.components.textGenerationService?.childProcesses['default']?.killed
                        }
                    });
                    
                    try {
                        const result = this.components.textGenerationService?.sendToChildProcess(
                            'default',
                            Buffer.from(JSON.stringify({ content: message }))
                        );
                        console.log('[ConversationalAgent] Text generation send result:', result);
                    } catch (error) {
                        console.error('[ConversationalAgent] Error sending to text generation:', error);
                    }
                }
            }
        });

        // Step 3: When we receive a response from the text generation service, send it to text to speech
        this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
            const rawText = data.toString().trim();
            console.log('[ConversationalAgent] Raw text generation response:', {
                rawText,
                length: rawText.length,
                identifier,
                timestamp: new Date().toISOString(),
                hasTTS: !!this.components.textToSpeechService
            });

            // Extract actual response - handle any response format
            let cleanMessage = "";
            
            // Extract actual response - handle any response format
            if (rawText.includes("::")) {
                // Format with :: delimiter (like "Agent -> User:: Hello")
                const parts = rawText.split("::");
                if (parts.length > 1) {
                    cleanMessage = parts[1].trim();
                }
            } else if (rawText.includes(": ")) {
                // Format with : delimiter (like "Agent -> Agent: Hello")
                const parts = rawText.split(": ");
                if (parts.length > 1) {
                    cleanMessage = parts[parts.length-1].trim();
                }
            } else {
                // Fallback - use the whole message
                cleanMessage = rawText.trim();
            }
            
            // Remove any confidence scores or metadata
            if (cleanMessage.includes("[confidence:")) {
                cleanMessage = cleanMessage.split("[confidence:")[0].trim();
            }
            
            console.log('[ConversationalAgent] Processed message for TTS:', {
                original: rawText,
                cleaned: cleanMessage,
                length: cleanMessage.length,
                timestamp: new Date().toISOString()
            });
            
            // Verify we have actual text to synthesize
            if (cleanMessage && cleanMessage.length > 0) {
                console.log('[ConversationalAgent] Sending to TTS:', {
                    message: cleanMessage,
                    length: cleanMessage.length,
                    timestamp: new Date().toISOString()
                });
                this.components.textToSpeechService?.sendToChildProcess('default', cleanMessage + '\n');
            } else {
                console.log('[ConversationalAgent] Warning: Empty cleaned message, using fallback text');
                // Send a fallback message if we couldn't extract anything
                this.components.textToSpeechService?.sendToChildProcess('default', "I'm here to assist you.\n");
            }
        });

        // Simplify TTS handling to send raw PCM data
        this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
            console.log('[ConversationalAgent] TTS audio data received:', {
                bytes: data.length,
                timestamp: new Date().toISOString()
            });
            
            if (data.length === 0) {
                console.log('[ConversationalAgent] Warning: Empty audio data from TTS');
                return;
            }
            
            // Basic info about the audio format
            this.scene.send(new NetworkId(95), {
                type: 'AudioData',
                targetPeer: this.targetPeer,
                format: 'pcm',
                sampleRate: 48000,
                bitsPerSample: 16,
                channels: 1,
                length: data.length
            });
            
            // Send in reasonably sized chunks
            const chunkSize = 8000; 
            for (let i = 0; i < data.length; i += chunkSize) {
                const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
                this.scene.send(new NetworkId(95), chunk);
                
                // This tiny delay helps prevent network congestion
                if (i + chunkSize < data.length) {
                    setTimeout(() => {}, 1);  
                }
            }
            
            console.log(`Sent ${Math.ceil(data.length / chunkSize)} chunks of PCM audio`, 'info');
        });
    }

    private sendAudioToPeer(audioData: Buffer, targetPeer: string) {
        try {
            console.log(`Sending ${audioData.length} bytes of audio to peer ${targetPeer}`);
            
            // Send smaller chunks to avoid network issues
            const chunkSize = 8000; // Smaller chunks for better transmission
            let sentBytes = 0;
            
            for (let i = 0; i < audioData.length; i += chunkSize) {
                const chunk = audioData.slice(i, Math.min(i + chunkSize, audioData.length));
                this.scene.send(new NetworkId(95), chunk);
                sentBytes += chunk.length;
                
                // Small delay between chunks to prevent flooding
                if (i + chunkSize < audioData.length) {
                    setTimeout(() => {}, 5);
                }
            }
            
            console.log(`Successfully sent ${sentBytes} bytes of audio data`);
        } catch (error) {
            console.error('Error sending audio data:', error);
        }
    }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const configPath = './config.json';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const absConfigPath = path.resolve(__dirname, configPath);
    const app = new ConversationalAgent(absConfigPath);
    app.start();
}
