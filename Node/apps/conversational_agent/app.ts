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
    private readonly SPEECH_THRESHOLD = 20;
    private readonly MIN_SPEECH_DURATION = 0.1; // 500ms
    private readonly MAX_PAUSE_DURATION = 0.7; // 500ms
    private readonly MIN_BUFFER_SIZE = 0; // 48,000 bytes for 0.5s
    private speechBuffer: Map<string, { 
        buffer: Uint8Array, 
        startTime: number, 
        isSpeaking: boolean,
        lastSpeechTime: number,
        totalDuration: number
    }> = new Map();

    constructor(configFile: string = 'config.json') {
        console.log('[ConversationalAgent] Initializing with config file:', configFile);
        super(configFile);
        
        // Load .env.local from project root
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Get activityId from environment variable with a default value
        this.activityId = process.env.ACTIVITY_ID || '5d2f8b7b-f1bf-4f8f-8f39-85649045fd45';
        this.log(`Initializing Conversational Agent for activity: ${this.activityId}`);

        setTimeout(() => this.testAudioPipeline(), 5000);
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
            this.components.speech2text = new SpeechToTextService(this.scene, 'SpeechToTextService', this.activityId);
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
            
            // Calculate audio level using RMS instead of simple average
            let sumOfSquares = 0;
            for (let i = 0; i < data.samples.length; i++) {
                sumOfSquares += data.samples[i] ** 2;
            }
            const rms = Math.sqrt(sumOfSquares / data.samples.length);
            console.log(`[MediaReceiver] Audio RMS: ${rms.toFixed(1)}`);

            // Initialize speech buffer for this peer if not exists
            if (!this.speechBuffer.has(uuid)) {
                this.speechBuffer.set(uuid, {
                    buffer: new Uint8Array(0),
                    startTime: Date.now(),
                    isSpeaking: false,
                    lastSpeechTime: Date.now(),
                    totalDuration: 0
                });
            }

            const speechState = this.speechBuffer.get(uuid)!;
            const currentTime = Date.now();

            // Check if this is speech
            if (rms > this.SPEECH_THRESHOLD) {
                if (!speechState.isSpeaking) {
                    console.log(`[MediaReceiver] Speech started from peer ${uuid}`);
                    speechState.isSpeaking = true;
                    speechState.startTime = currentTime;
                    speechState.buffer = new Uint8Array(0);
                }
                speechState.lastSpeechTime = currentTime;
                speechState.totalDuration = (currentTime - speechState.startTime) / 1000;
                speechState.buffer = new Uint8Array([...speechState.buffer, ...sampleBuffer]);
            } else {
                if (speechState.isSpeaking) {
                    const silenceDuration = (currentTime - speechState.lastSpeechTime) / 1000;
                    if (silenceDuration >= this.MAX_PAUSE_DURATION) {
                        const finalDuration = (currentTime - speechState.startTime) / 1000;
                        const meetsDuration = finalDuration >= this.MIN_SPEECH_DURATION;
                        
                        console.log(`[MediaReceiver] Size check - Needed: 20% (${this.MIN_BUFFER_SIZE*0.2} bytes), Actual: ${finalDuration.toFixed(2)}s`);
                        
                        if (speechState.buffer.length > 0) {
                            if (meetsDuration) {
                                console.log(`[MediaReceiver] Sending valid speech (${finalDuration.toFixed(2)}s, ${speechState.buffer.length} bytes)`);
                                this.components.speech2text?.sendToChildProcess(uuid, Buffer.from(speechState.buffer));
                            } else {
                                console.log(`[MediaReceiver] Rejected segment - Duration: ${finalDuration.toFixed(2)}s, Size: ${speechState.buffer.length} bytes`, {
                                    meetsDuration
                                });
                            }
                        }
                        
                        // Reset state
                        speechState.isSpeaking = false;
                        speechState.buffer = new Uint8Array(0);
                        speechState.totalDuration = 0;
                        speechState.startTime = currentTime;
                        speechState.lastSpeechTime = currentTime;
                    }
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
            try {
                // Get peer information
                const peer = this.roomClient.peers.get(identifier);
                if (!peer) {
                    console.log(`[ConversationalAgent] Received STT data for unknown peer: ${identifier}`);
                    return;
                }

                const peerName = peer.properties.get('ubiq.displayname') || 'User';
                
                // Clean and validate the response
                let response = data.toString().trim();
                
                // Skip debug messages
                if (response.startsWith('[DEBUG]')) {
                    console.log('[ConversationalAgent] Skipping debug message:', response);
                    return;
                }

                console.log('[ConversationalAgent] Raw STT response:', {
                    response,
                    length: response.length,
                    peer: peerName,
                    identifier,
                    timestamp: new Date().toISOString()
                });

                // Only process responses starting with '>'
                if (!response.startsWith('>')) {
                    console.log('[ConversationalAgent] Ignoring non-transcription response:', response);
                    return;
                }

                // Remove the '>' prefix and clean the response
                response = response.slice(1).trim();
                if (!response) {
                    console.log('[ConversationalAgent] Empty transcription after cleaning');
                    return;
                }

                // Format the message for the agent
                const message = `${peerName} -> Agent:: ${response}`;
                console.log('[ConversationalAgent] Formatted message:', {
                    message,
                    peer: peerName,
                    response,
                    timestamp: new Date().toISOString()
                });

                // Log the message
                this.log(message);

                // Check if text generation service is available
                if (!this.components.textGenerationService) {
                    console.error('[ConversationalAgent] Text generation service not available');
                    return;
                }

                // Send to text generation service
                const payload = JSON.stringify({ 
                    content: message,
                    activityId: this.activityId,
                    timestamp: new Date().toISOString()
                });

                console.log('[ConversationalAgent] Sending to text generation:', {
                    message,
                    activityId: this.activityId,
                    payloadLength: payload.length,
                    serviceState: {
                        pid: this.components.textGenerationService.childProcesses['default']?.pid,
                        killed: this.components.textGenerationService.childProcesses['default']?.killed
                    }
                });

                const result = this.components.textGenerationService.sendToChildProcess(
                    'default',
                    Buffer.from(payload)
                );

                console.log('[ConversationalAgent] Text generation send result:', {
                    success: result,
                    timestamp: new Date().toISOString()
                });

            } catch (error) {
                console.error('[ConversationalAgent] Error processing STT output:', {
                    error: error instanceof Error ? error.message : String(error),
                    identifier,
                    timestamp: new Date().toISOString()
                });
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

        // Handle TTS audio output
        this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
            console.log('[ConversationalAgent] TTS audio data received:', {
                bytes: data.length,
                timestamp: new Date().toISOString()
            });
            
            if (data.length === 0) {
                console.log('[ConversationalAgent] Warning: Empty audio data from TTS');
                return;
            }

            // Get the last peer that spoke to us
            const lastSpeaker = Array.from(this.speechBuffer.entries())
                .filter(([_, state]) => state.isSpeaking)
                .map(([uuid]) => uuid)[0];

            if (!lastSpeaker) {
                console.log('[ConversationalAgent] Warning: No target peer found for TTS output');
                return;
            }

            // Set target peer for this response
            this.targetPeer = lastSpeaker;
            
            // Send audio format information
            this.scene.send(new NetworkId(95), {
                type: 'AudioData',
                targetPeer: this.targetPeer,
                format: 'pcm',
                sampleRate: 48000,
                bitsPerSample: 16,
                channels: 1,
                length: data.length
            });
            
            // Send audio data in chunks
            const chunkSize = 8000; // 100ms of audio at 48kHz
            let sentBytes = 0;
            
            for (let i = 0; i < data.length; i += chunkSize) {
                const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
                this.scene.send(new NetworkId(95), chunk);
                sentBytes += chunk.length;
                
                // Small delay between chunks to prevent flooding
                if (i + chunkSize < data.length) {
                    setTimeout(() => {}, 5);
                }
            }
            
            console.log(`[ConversationalAgent] Sent ${sentBytes} bytes of TTS audio to peer ${this.targetPeer}`);
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

    private testAudioPipeline() {
        const testAudio = new Uint8Array(48000).fill(128); // 1s of silence
        console.log('[TEST] Injecting test audio');
        this.components.speech2text?.sendToChildProcess(
            this.roomClient?.peer?.uuid || 'test-peer',
            Buffer.from(testAudio)
        );
    }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const configPath = './config.json';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const absConfigPath = path.resolve(__dirname, configPath);
    const app = new ConversationalAgent(absConfigPath);
    app.start();
}
