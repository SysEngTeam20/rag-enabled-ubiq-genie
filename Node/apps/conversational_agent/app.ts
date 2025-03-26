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

export class ConversationalAgent extends ApplicationController {
    components: {
        mediaReceiver?: MediaReceiver;
        speech2text?: SpeechToTextService;
        textGenerationService?: TextGenerationService;
        textToSpeechService?: TextToSpeechService;
    } = {};
    targetPeer: string = '';
    private activityId: string;
    private lastProcessedTime: { [key: string]: number } = {};
    private readonly COOLDOWN_MS = 1000; // 1 seconds between processing
    private readonly AMPLITUDE_THRESHOLD = 100; // Adjusted based on observed speech values
    private readonly MIN_DURATION_MS = 200; // Minimum speech duration
    private readonly SILENCE_THRESHOLD_MS = 1500; // Time of silence before processing speech
    private speechStartTime: { [key: string]: number } = {};
    private speechBuffer: { [key: string]: Buffer[] } = {};
    private lastSpeechTime: { [key: string]: number } = {};
    private lastTTSMessage: string = '';
    private lastTTSTime: number = 0;
    
    // Wake word patterns
    private readonly WAKE_WORDS = [
        'hi', 'hey', 'ok', 'hello', 'yo', 'greetings', 'alright', 'well', 'so', 'now'
    ];
    private readonly GENIE_VARIATIONS = [
        'genie', 'jeannie', 'jeanie', 'jeany', 'jeeny', 'jeani', 'jeane', 'jeanee', 'jeannie', 'jeanni', 'jinnie', 'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'jimmy',
        'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'gini', 'allen', 'alan', 'allan', 'alen'
    ];

    constructor(configFile: string = 'config.json') {
        super(configFile);
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        this.activityId = process.env.ACTIVITY_ID || '5d2f8b7b-f1bf-4f8f-8f39-85649045fd45';
    }

    start(): void {
        this.registerComponents();
        this.definePipeline();
        this.joinRoom();
    }

    registerComponents() {
        console.log('[ConversationalAgent] Registering components...');
        this.components.mediaReceiver = new MediaReceiver(this.scene);
        this.components.speech2text = new SpeechToTextService(this.scene, 'SpeechToTextService', this.activityId);
        this.components.textGenerationService = new TextGenerationService(this.scene, this.activityId);
        this.components.textToSpeechService = new TextToSpeechService(this.scene);
        
        // Verify components are initialized
        console.log('[ConversationalAgent] Component initialization status:');
        console.log(`  - MediaReceiver: ${!!this.components.mediaReceiver}`);
        console.log(`  - Speech2Text: ${!!this.components.speech2text}`);
        console.log(`  - TextGeneration: ${!!this.components.textGenerationService}`);
        console.log(`  - TextToSpeech: ${!!this.components.textToSpeechService}`);
    }

    definePipeline() {
        this.components.mediaReceiver?.on('audio', (uuid: string, data: RTCAudioData) => {
            if (!this.roomClient.peers.get(uuid)) return;

            const now = Date.now();
            const lastProcessed = this.lastProcessedTime[uuid] || 0;
            
            // Calculate average amplitude
            let sum = 0;
            for (const sample of data.samples) {
                sum += Math.abs(sample);
            }
            const avgAmplitude = sum / data.samples.length;
            
            // Check cooldown
            if (now - lastProcessed < this.COOLDOWN_MS) return;
            
            // Check amplitude threshold
            if (avgAmplitude < this.AMPLITUDE_THRESHOLD) {
                // If we were collecting speech, check if we should process it
                if (this.speechStartTime[uuid]) {
                    const duration = now - this.speechStartTime[uuid];
                    const silenceDuration = now - (this.lastSpeechTime[uuid] || 0);
                    
                    // Only process if we've had enough silence or the speech is long enough
                    if (silenceDuration >= this.SILENCE_THRESHOLD_MS || duration >= 5000) {
                        // Process accumulated speech
                        const combinedBuffer = Buffer.concat(this.speechBuffer[uuid].map(b => new Uint8Array(b)));
                        console.log(`Speech detected - duration: ${duration}ms, amplitude: ${avgAmplitude.toFixed(2)}`);
                        this.lastProcessedTime[uuid] = now;
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
                this.components.speech2text?.startSpeechCollection(uuid);
            }
            // Only add to buffer if we're above threshold
            this.speechBuffer[uuid].push(Buffer.from(data.samples.buffer));
        });

        this.components.speech2text?.on('data', (data: Buffer, identifier: string) => {
            try {
                const response = data.toString().trim();
                console.log(`[ConversationalAgent] Received STT data: "${response}"`);
                
                let text = '';
                
                // Handle both JSON and plain text responses
                if (response.startsWith('{')) {
                    try {
                        const jsonResponse = JSON.parse(response);
                        console.log(`[ConversationalAgent] Parsed STT response:`, jsonResponse);
                        text = jsonResponse.text;
                    } catch (error) {
                        console.error(`[ConversationalAgent] Error parsing JSON response:`, error);
                        return;
                    }
                } else {
                    // Handle plain text response
                    text = response;
                }
                
                // Skip if no valid text or if it's a no-speech message
                if (!text || text === '[No speech detected]') {
                    console.log('[ConversationalAgent] No valid text in STT response, skipping text generation');
                    return;
                }

                // Check for wake word
                const lowerText = text.toLowerCase();
                const hasWakeWord = this.WAKE_WORDS.some(wakeWord => 
                    lowerText.startsWith(wakeWord + ' ') || lowerText.startsWith(wakeWord + ',')
                );
                
                const hasGenie = this.GENIE_VARIATIONS.some(variation => 
                    lowerText.includes(' ' + variation) || lowerText.includes(',' + variation)
                );

                // if (!hasWakeWord || !hasGenie) {
                if (!hasGenie) {
                    console.log('[ConversationalAgent] No wake word detected, ignoring message');
                    return;
                }

                // Remove wake word and genie variation from the text
                let cleanedText = text;
                for (const wakeWord of this.WAKE_WORDS) {
                    const regex = new RegExp(`^${wakeWord}\\s*[,]?\\s*`, 'i');
                    cleanedText = cleanedText.replace(regex, '');
                }
                for (const variation of this.GENIE_VARIATIONS) {
                    const regex = new RegExp(`\\s*[,]?\\s*${variation}\\b`, 'i');
                    cleanedText = cleanedText.replace(regex, '');
                }
                cleanedText = cleanedText.trim();
                
                if (!cleanedText) {
                    console.log('[ConversationalAgent] No message content after removing wake word');
                    return;
                }
                
                const peer = this.roomClient.peers.get(identifier);
                const peerName = peer?.properties.get('ubiq.displayname') || 'User';
                const message = `${peerName} -> Agent:: ${cleanedText}`;
                console.log(`[ConversationalAgent] Sending to text generation: "${message}"`);
                
                if (this.components.textGenerationService) {
                    console.log('[ConversationalAgent] Text generation service exists, sending data...');
                    this.components.textGenerationService.sendToChildProcess('default', Buffer.from(message));
                } else {
                    console.error('[ConversationalAgent] Text generation service is not initialized!');
                }
            } catch (error) {
                console.error(`[ConversationalAgent] Error processing STT response:`, error);
            }
        });

        this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
            try {
                const response = data.toString().trim();
                console.log(`[ConversationalAgent] Received text generation: "${response}"`);
                
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
                        console.log('[ConversationalAgent] Skipping duplicate TTS request');
                        return;
                    }
                    
                    console.log(`[ConversationalAgent] Sending to TTS: "${cleanedMessage}"`);
                    
                    // Only send to TTS if we have a valid message and TTS service
                    if (cleanedMessage && this.components.textToSpeechService) {
                        this.components.textToSpeechService.sendToChildProcess('default', cleanedMessage);
                        this.lastTTSMessage = cleanedMessage;
                        this.lastTTSTime = now;
                    } else {
                        console.warn('[ConversationalAgent] Skipping TTS - no valid message or TTS service not available');
                    }
                } else {
                    console.warn(`[ConversationalAgent] Invalid text generation response format: "${response}"`);
                }
            } catch (error) {
                console.error(`[ConversationalAgent] Error processing text generation response:`, error);
            }
        });

        this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
            if (data.length > 0) {
                console.log(`[ConversationalAgent] Received TTS audio, length: ${data.length}`);
                this.scene.send(new NetworkId(95), {
                    type: 'AudioData',
                    targetPeer: this.targetPeer,
                    format: 'pcm',
                    sampleRate: 48000,
                    bitsPerSample: 16,
                    channels: 1,
                    length: data.length
                });

                const chunkSize = 16000;
                for (let i = 0; i < data.length; i += chunkSize) {
                    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
                    this.scene.send(new NetworkId(95), chunk);
                    if (i + chunkSize < data.length) {
                        setTimeout(() => {}, 5);
                    }
                }
            }
        });
    }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const configPath = './config.json';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const absConfigPath = path.resolve(__dirname, configPath);
    const app = new ConversationalAgent(absConfigPath);
    app.start();
}

