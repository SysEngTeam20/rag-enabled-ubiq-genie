import { NetworkId, NetworkScene } from 'ubiq';
import { RoomClient } from 'ubiq-server/components/roomclient.js';
import { TextToSpeechService } from '../../services/text_to_speech/service';
import { SpeechToTextService } from '../../services/speech_to_text/service';
import { TextGenerationService } from '../../services/text_generation/service';
import { MediaReceiver } from '../../components/media_receiver';
import path from 'path';
import { RTCAudioData } from '@roamhq/wrtc/types/nonstandard';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import nconf from 'nconf';
import { Logger } from '../../components/logger';

export class ConversationalAgent extends EventEmitter {
    components: {
        mediaReceiver?: MediaReceiver;
        speech2text?: SpeechToTextService;
        textGenerationService?: TextGenerationService;
        textToSpeechService?: TextToSpeechService;
    } = {};
    targetPeer: string = '';
    private sceneId: string;
    private scene: NetworkScene;
    private roomClient: RoomClient;
    private lastProcessedTime: { [key: string]: number } = {};
    private readonly COOLDOWN_MS = 1000; // 1 seconds between processing
    private readonly AMPLITUDE_THRESHOLD = 50; // Lower threshold to detect speech more easily
    private readonly MIN_DURATION_MS = 200; // Minimum speech duration
    private readonly SILENCE_THRESHOLD_MS = 1000; // Reduced silence time before processing speech
    private speechStartTime: { [key: string]: number } = {};
    private speechBuffer: { [key: string]: Buffer[] } = {};
    private lastSpeechTime: { [key: string]: number } = {};
    private lastTTSMessage: string = '';
    private lastTTSTime: number = 0;
    private isStarted: boolean = false;
    
    // Wake word patterns
    private readonly WAKE_WORDS = [
        'hi', 'hey', 'ok', 'hello', 'yo', 'greetings', 'alright', 'well', 'so', 'now',
        'excuse me', 'can you', 'could you', 'would you', 'please', 'may i',
        'listen', 'tell me', 'help', 'assist', 'what is', 'how to', 'i need', 'i want'
    ];
    private readonly GENIE_VARIATIONS = [
        'genie', 'jeannie', 'jeanie', 'jeany', 'jeeny', 'jeani', 'jeane', 'jeanee', 'jeannie', 'jeanni', 
        'jinnie', 'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'jimmy',
        'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'gini', 'allen', 'alan', 'allan', 'alen',
        'gini', 'genie', 'geny', 'jenny', 'jeny', 'ginny', 'assistant', 'agent', 'ai', 'computer', 'bot',
        'g', 'gene', 'jen', 'jin', 'gen', 'genius', 'genies'
    ];

    constructor(scene: NetworkScene, roomClient: RoomClient, sceneId: string) {
        super();
        
        try {
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
            Logger.log('ConversationalAgent', `CONSTRUCTING AGENT FOR SCENE: ${sceneId}`, 'info');
            
            // Initialize configuration
            const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
            Logger.log('ConversationalAgent', `Loading config from: ${configPath}`, 'info');
            nconf.file(configPath);
            
            const envPath = path.resolve(process.cwd(), '.env.local');
            Logger.log('ConversationalAgent', `Loading environment from: ${envPath}`, 'info');
            dotenv.config({ path: envPath });
            
            this.scene = scene;
            this.roomClient = roomClient;
            this.sceneId = sceneId;
            
            // Log some context info
            Logger.log('ConversationalAgent', `Scene valid: ${!!this.scene}`, 'info');
            Logger.log('ConversationalAgent', `RoomClient valid: ${!!this.roomClient}`, 'info');
            Logger.log('ConversationalAgent', `Room GUID: ${this.sceneId}`, 'info');
            
            // Check RoomClient peers
            const peerCount = this.roomClient.peers.size;
            const peerIds = Array.from(this.roomClient.peers.keys());
            Logger.log('ConversationalAgent', `RoomClient has ${peerCount} peers: [${peerIds.join(', ')}]`, 'info');
            
            Logger.log('ConversationalAgent', `Agent constructor completed for scene: ${sceneId}`, 'info');
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR in constructor: ${error}`, 'error');
            throw error;
        }
    }

    start(): void {
        try {
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
            Logger.log('ConversationalAgent', `STARTING AGENT FOR SCENE: ${this.sceneId}`, 'info');
            
            // Register components first
            this.registerComponents();
            
            // Then set up the pipeline
            this.definePipeline();
            
            // Send a test message to verify the agent is working
            this.sendTestMessage();
            
            this.isStarted = true;
            Logger.log('ConversationalAgent', `Agent successfully started for scene: ${this.sceneId}`, 'info');
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
            
            // Emit a started event that others can listen for
            this.emit('started', this.sceneId);
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR starting agent: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Send a test message to verify the text-to-speech pipeline is working
     */
    private sendTestMessage(): void {
        try {
            Logger.log('ConversationalAgent', 'Sending test message to verify agent is working', 'info');
            
            // Create a simple welcome message
            const testMessage = "Agent is now active and ready to assist.";
            
            // If TTS service is available, send the message
            if (this.components.textToSpeechService) {
                Logger.log('ConversationalAgent', `Sending test message to TTS: "${testMessage}"`, 'info');
                this.components.textToSpeechService.sendToChildProcess('default', testMessage);
            } else {
                Logger.log('ConversationalAgent', 'Cannot send test message - TTS service not available', 'warning');
            }
        } catch (error) {
            Logger.log('ConversationalAgent', `Error sending test message: ${error}`, 'error');
        }
    }

    registerComponents() {
        try {
            Logger.log('ConversationalAgent', `Registering components for scene: ${this.sceneId}`, 'info');
            
            // Ensure the RoomClient is properly connected first
            if (!this.roomClient) {
                Logger.log('ConversationalAgent', 'No RoomClient available! RTC will not work properly', 'error');
                return;
            }
            
            // Confirm room client is properly joined to a room
            const roomId = this.sceneId || (this.roomClient as any).room?.id || (this.roomClient as any).roomId;
            Logger.log('ConversationalAgent', `RoomClient is connected to room: ${roomId || 'unknown'}`, 'info');
            Logger.log('ConversationalAgent', `RoomClient has ${this.roomClient.peers?.size || 0} peers`, 'info');
            
            // Create each component with detailed logging
            Logger.log('ConversationalAgent', 'Creating MediaReceiver...', 'info');
            try {
                // Verify that the scene has network components before creating the MediaReceiver
                Logger.log('ConversationalAgent', `Scene verification: hasScene=${!!this.scene}, hasRoomClient=${!!this.roomClient}`, 'info');
                
                // Log detailed information about the scene
                if (this.scene) {
                    Logger.log('ConversationalAgent', `Scene properties: id=${(this.scene as any).id}, hasOnMethod=${typeof this.scene.on === 'function'}`, 'info');
                }
                
                // Create media receiver with both scene and roomClient references
                Logger.log('ConversationalAgent', 'Creating MediaReceiver with scene and roomClient', 'info');
                this.components.mediaReceiver = new MediaReceiver(this.scene, this.roomClient);
                
                // Start the media receiver explicitly
                if (this.components.mediaReceiver && typeof this.components.mediaReceiver.start === 'function') {
                    Logger.log('ConversationalAgent', 'Starting MediaReceiver explicitly', 'info');
                    this.components.mediaReceiver.start();
                }
            } catch (error) {
                Logger.log('ConversationalAgent', `ERROR creating MediaReceiver: ${error}`, 'error');
            }
            
            Logger.log('ConversationalAgent', 'Creating SpeechToTextService...', 'info');
            this.components.speech2text = new SpeechToTextService(this.scene, 'SpeechToTextService', this.sceneId);
            
            Logger.log('ConversationalAgent', 'Creating TextGenerationService...', 'info');
            this.components.textGenerationService = new TextGenerationService(this.scene, this.sceneId);
            
            Logger.log('ConversationalAgent', 'Creating TextToSpeechService...', 'info');
            this.components.textToSpeechService = new TextToSpeechService(this.scene);
            
            // Verify components are initialized
            Logger.log('ConversationalAgent', 'Component initialization status:', 'info');
            Logger.log('ConversationalAgent', `  - MediaReceiver: ${!!this.components.mediaReceiver}`, 'info');
            Logger.log('ConversationalAgent', `  - Speech2Text: ${!!this.components.speech2text}`, 'info');
            Logger.log('ConversationalAgent', `  - TextGeneration: ${!!this.components.textGenerationService}`, 'info');
            Logger.log('ConversationalAgent', `  - TextToSpeech: ${!!this.components.textToSpeechService}`, 'info');
            
            // Initialize the speech to text service with the room client
            if (this.components.speech2text) {
                Logger.log('ConversationalAgent', 'Setting room client on SpeechToTextService', 'info');
                this.components.speech2text.setRoomClient(this.roomClient);
            }
            
            Logger.log('ConversationalAgent', 'All components registered successfully', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR registering components: ${error}`, 'error');
            throw error;
        }
    }

    definePipeline() {
        try {
            Logger.log('ConversationalAgent', `Setting up event pipeline for scene: ${this.sceneId}`, 'info');
            
            // Audio pipeline
            if (this.components.mediaReceiver) {
                Logger.log('ConversationalAgent', 'Setting up audio pipeline...', 'info');
                
                // Audio volume debugging
                let lastAudioLogTime = 0;
                const AUDIO_LOG_INTERVAL = 5000; // Log audio levels every 5 seconds
                const audioLevels: {[key: string]: number[]} = {};
                
                // Add direct diagnostic logging to help debug audio
                Logger.log('ConversationalAgent', 'AUDIO DIAGNOSTICS: Adding audio event listener to MediaReceiver', 'info');
                Logger.log('ConversationalAgent', `MediaReceiver has 'on' method: ${typeof this.components.mediaReceiver.on === 'function'}`, 'info');
                
                // Verify that event handlers are actually being registered
                const originalOn = this.components.mediaReceiver.on;
                // Define a new 'on' method that logs the registration
                (this.components.mediaReceiver as any).on = function(event: string, callback: any) {
                    Logger.log('ConversationalAgent', `Registering event handler for '${event}' event`, 'info');
                    return originalOn.call(this, event, callback);
                };
                
                // Create a counter for audio packets
                let packetCounter = 0;
                
                this.components.mediaReceiver.on('audio', (uuid: string, data: RTCAudioData) => {
                    // Log the first audio packet and then every 100th packet
                    packetCounter++;
                    if (packetCounter === 1 || packetCounter % 100 === 0) {
                        Logger.log('ConversationalAgent', `AUDIO RECEIVED [packet ${packetCounter}]: Peer=${uuid}, Samples=${data.samples.length}`, 'info');
                    }
                    
                    if (!this.roomClient.peers.get(uuid)) return;

                    const now = Date.now();
                    const lastProcessed = this.lastProcessedTime[uuid] || 0;
                    
                    // Calculate average amplitude
                    let sum = 0;
                    for (const sample of data.samples) {
                        sum += Math.abs(sample);
                    }
                    const avgAmplitude = sum / data.samples.length;
                    
                    // Audio level debugging
                    if (!audioLevels[uuid]) {
                        audioLevels[uuid] = [];
                    }
                    audioLevels[uuid].push(avgAmplitude);
                    
                    // Log audio levels periodically
                    if (now - lastAudioLogTime > AUDIO_LOG_INTERVAL) {
                        lastAudioLogTime = now;
                        
                        // Calculate and log average levels for each peer
                        Object.entries(audioLevels).forEach(([peerUuid, levels]) => {
                            if (levels.length > 0) {
                                const avgLevel = levels.reduce((sum, val) => sum + val, 0) / levels.length;
                                const peer = this.roomClient.peers.get(peerUuid);
                                const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                                Logger.log('ConversationalAgent', `[AUDIO LEVELS] Peer ${peerName} (${peerUuid}): avg=${avgLevel.toFixed(2)}, samples=${levels.length}, threshold=${this.AMPLITUDE_THRESHOLD}`, 'info');
                            }
                            // Reset the levels array
                            audioLevels[peerUuid] = [];
                        });
                    }
                    
                    // Reduce amplitude threshold if we're not detecting speech
                    // Default threshold is 100, but we'll adapt based on observed levels
                    const adaptiveThreshold = this.AMPLITUDE_THRESHOLD;
                    
                    // Check cooldown
                    if (now - lastProcessed < this.COOLDOWN_MS) return;
                    
                    // Check amplitude threshold with the adaptive threshold
                    if (avgAmplitude < adaptiveThreshold) {
                        // If we were collecting speech, check if we should process it
                        if (this.speechStartTime[uuid]) {
                            const duration = now - this.speechStartTime[uuid];
                            const silenceDuration = now - (this.lastSpeechTime[uuid] || 0);
                            
                            // Only process if we've had enough silence or the speech is long enough
                            if (silenceDuration >= this.SILENCE_THRESHOLD_MS || duration >= 5000) {
                                // Process accumulated speech
                                const combinedBuffer = Buffer.concat(this.speechBuffer[uuid].map(b => new Uint8Array(b)));
                                Logger.log('ConversationalAgent', `Speech detected - duration: ${duration}ms, amplitude: ${avgAmplitude.toFixed(2)}, bufferSize: ${combinedBuffer.length} bytes`, 'info');
                                this.lastProcessedTime[uuid] = now;
                                
                                // Send to speech-to-text service
                                const peer = this.roomClient.peers.get(uuid);
                                const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                                Logger.log('ConversationalAgent', `Processing speech from ${peerName} (${uuid})`, 'info');
                                
                                this.components.speech2text?.sendToChildProcess(uuid, combinedBuffer);
                                
                                // Reset speech collection
                                this.speechStartTime[uuid] = 0;
                                this.speechBuffer[uuid] = [];
                                this.components.speech2text?.stopSpeechCollection(uuid);
                            }
                        }
                        return;
                    }

                    // Update last speech time
                    this.lastSpeechTime[uuid] = now;

                    // Start or continue collecting speech
                    if (!this.speechStartTime[uuid]) {
                        this.speechStartTime[uuid] = now;
                        this.speechBuffer[uuid] = [];
                        
                        const peer = this.roomClient.peers.get(uuid);
                        const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                        Logger.log('ConversationalAgent', `Started speech collection for ${peerName} (${uuid})`, 'info');
                        
                        this.components.speech2text?.startSpeechCollection(uuid);
                    }
                    // Only add to buffer if we're above threshold
                    this.speechBuffer[uuid].push(Buffer.from(data.samples.buffer));
                });
            }

            this.components.speech2text?.on('data', (data: Buffer, identifier: string) => {
                try {
                    const response = data.toString().trim();
                    const peer = this.roomClient.peers.get(identifier);
                    const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                    Logger.log('ConversationalAgent', `Received STT data from ${peerName}: "${response}"`, 'info');
                    
                    let text = '';
                    
                    // Handle both JSON and plain text responses
                    if (response.startsWith('{')) {
                        try {
                            const jsonResponse = JSON.parse(response);
                            Logger.log('ConversationalAgent', `Parsed STT response:`, 'info');
                            text = jsonResponse.text;
                        } catch (error) {
                            Logger.log('ConversationalAgent', `Error parsing JSON response: ${error}`, 'error');
                            return;
                        }
                    } else {
                        // Handle plain text response
                        text = response;
                    }
                    
                    // Skip if no valid text or if it's a no-speech message
                    if (!text || text === '[No speech detected]') {
                        Logger.log('ConversationalAgent', 'No valid text in STT response, skipping text generation', 'info');
                        return;
                    }

                    // Log the text for debugging
                    Logger.log('ConversationalAgent', `Transcribed speech from ${peerName}: "${text}"`, 'info');

                    // Check for wake word - now much more lenient to catch more cases
                    const lowerText = text.toLowerCase();
                    
                    // Check for any wake word
                    const hasWakeWord = this.WAKE_WORDS.some(wakeWord => 
                        lowerText.includes(wakeWord)
                    );
                    
                    // Check for any genie variation
                    const hasGenie = this.GENIE_VARIATIONS.some(variation => 
                        lowerText.includes(variation)
                    );
                    
                    // Debug log for wake word detection
                    Logger.log('ConversationalAgent', `Wake word detection: hasWakeWord=${hasWakeWord}, hasGenie=${hasGenie}`, 'info');

                    // Make wake word optional but keep genie required
                    // if (!hasWakeWord || !hasGenie) {
                    if (!hasGenie) {
                        Logger.log('ConversationalAgent', 'No wake word detected, ignoring message', 'info');
                        return;
                    }

                    // Remove wake word and genie variation from the text
                    let cleanedText = text;
                    for (const wakeWord of this.WAKE_WORDS) {
                        const regex = new RegExp(`\\b${wakeWord}\\b\\s*[,]?\\s*`, 'i');
                        cleanedText = cleanedText.replace(regex, '');
                    }
                    for (const variation of this.GENIE_VARIATIONS) {
                        const regex = new RegExp(`\\s*[,]?\\s*\\b${variation}\\b`, 'i');
                        cleanedText = cleanedText.replace(regex, '');
                    }
                    cleanedText = cleanedText.trim();
                    
                    if (!cleanedText) {
                        Logger.log('ConversationalAgent', 'No message content after removing wake word', 'info');
                        return;
                    }
                    
                    const message = `${peerName} -> Agent:: ${cleanedText}`;
                    Logger.log('ConversationalAgent', `Sending to text generation: "${message}"`, 'info');
                    
                    if (this.components.textGenerationService) {
                        Logger.log('ConversationalAgent', 'Text generation service exists, sending data...', 'info');
                        this.components.textGenerationService.sendToChildProcess('default', Buffer.from(message));
                    } else {
                        Logger.log('ConversationalAgent', 'Text generation service does not exist!', 'error');
                    }
                } catch (error) {
                    Logger.log('ConversationalAgent', `Error processing STT response: ${error}`, 'error');
                }
            });

            this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
                try {
                    const response = data.toString().trim();
                    Logger.log('ConversationalAgent', `Received text generation: "${response}"`, 'info');
                    
                    // Extract the name and message from the response
                    const [, name, message] = response.match(/-> (.*?):: (.*)/) || [];
                    
                    if (name && message) {
                        this.targetPeer = name.trim();
                        // Clean up the message by removing all possible prefixes and formats
                        const cleanedMessage = message
                            // Remove any "Agent -> Username::" prefixes
                            .replace(/^Agent\s*->\s*[^:]+::\s*/g, '')
                            // Remove any "Username -> Agent::" prefixes
                            .replace(/^[^:]+ -> Agent::\s*/g, '')
                            // Remove any remaining "Agent -> Username:" patterns
                            .replace(/Agent\s*->\s*[^:]+:\s*/g, '')
                            // Remove any remaining "Username -> Agent:" patterns
                            .replace(/[^:]+ -> Agent:\s*/g, '')
                            // Remove any remaining "->" patterns
                            .replace(/->\s*[^:]+::?\s*/g, '')
                            // Clean up any remaining whitespace
                            .trim();
                        
                        // Check if this is a duplicate message within 1 second
                        const now = Date.now();
                        if (cleanedMessage === this.lastTTSMessage && (now - this.lastTTSTime) < 1000) {
                            Logger.log('ConversationalAgent', 'Skipping duplicate TTS request', 'info');
                            return;
                        }
                        
                        Logger.log('ConversationalAgent', `Sending to TTS: "${cleanedMessage}"`, 'info');
                        
                        // Only send to TTS if we have a valid message and TTS service
                        if (cleanedMessage && this.components.textToSpeechService) {
                            this.components.textToSpeechService.sendToChildProcess('default', cleanedMessage);
                            this.lastTTSMessage = cleanedMessage;
                            this.lastTTSTime = now;
                        } else {
                            Logger.log('ConversationalAgent', 'Skipping TTS - no valid message or TTS service not available', 'warning');
                        }
                    } else {
                        Logger.log('ConversationalAgent', `Invalid text generation response format: "${response}"`, 'warning');
                    }
                } catch (error) {
                    Logger.log('ConversationalAgent', `Error processing text generation response: ${error}`, 'error');
                }
            });

            this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
                if (data.length > 0) {
                    Logger.log('ConversationalAgent', `Received TTS data of length: ${data.length} bytes`, 'info');
                    this.emit('tts-data', data);
                }
            });
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR setting up pipeline: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Shut down the agent and clean up resources
     */
    shutdown(): void {
        Logger.log('ConversationalAgent', `Shutting down agent for scene: ${this.sceneId}`, 'info');
        
        // Clean up each component
        Object.keys(this.components).forEach(key => {
            const component = this.components[key as keyof typeof this.components];
            if (component) {
                try {
                    if ('cleanup' in component && typeof (component as any).cleanup === 'function') {
                        (component as any).cleanup();
                    } else if ('shutdown' in component && typeof (component as any).shutdown === 'function') {
                        (component as any).shutdown();
                    }
                } catch (error) {
                    Logger.log('ConversationalAgent', `Error shutting down component ${key}: ${error}`, 'error');
                }
            }
        });
        
        // Clear all buffers and state
        this.speechBuffer = {};
        this.speechStartTime = {};
        this.lastProcessedTime = {};
        this.lastSpeechTime = {};
        
        // Remove all listeners
        this.removeAllListeners();
        
        Logger.log('ConversationalAgent', `Agent shutdown complete for scene: ${this.sceneId}`, 'info');
    }

    cleanup(): void {
        try {
            Logger.log('ConversationalAgent', `Cleaning up agent for scene: ${this.sceneId}`, 'info');
            
            // Clean up each component specifically based on its type
            if (this.components.speech2text) {
                Logger.log('ConversationalAgent', 'Cleaning up SpeechToTextService', 'info');
                if ('cleanup' in this.components.speech2text) {
                    (this.components.speech2text as any).cleanup();
                }
            }
            
            if (this.components.textGenerationService) {
                Logger.log('ConversationalAgent', 'Cleaning up TextGenerationService', 'info');
                if ('cleanup' in this.components.textGenerationService) {
                    (this.components.textGenerationService as any).cleanup();
                }
            }
            
            if (this.components.textToSpeechService) {
                Logger.log('ConversationalAgent', 'Cleaning up TextToSpeechService', 'info');
                if ('shutdown' in this.components.textToSpeechService) {
                    (this.components.textToSpeechService as any).shutdown();
                }
            }
            
            if (this.components.mediaReceiver) {
                Logger.log('ConversationalAgent', 'Cleaning up MediaReceiver', 'info');
                // MediaReceiver doesn't have cleanup/shutdown methods
                // Just remove all listeners
                this.components.mediaReceiver.removeAllListeners();
            }
            
            // Clear all component references
            this.components = {};
            
            // Remove all listeners from this agent
            this.removeAllListeners();
            
            Logger.log('ConversationalAgent', `Agent cleanup completed for scene: ${this.sceneId}`, 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR in cleanup: ${error}`, 'error');
        }
    }
}