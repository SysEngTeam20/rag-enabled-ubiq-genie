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

    constructor(configFile: string = 'config.json') {
        super(configFile);
        
        // Load .env.local from project root
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Get activityId from environment variable with a default value
        this.activityId = process.env.ACTIVITY_ID || '0742fc56-8e73-4d73-9488-60a3d936351b';
        this.log(`Initializing Conversational Agent for activity: ${this.activityId}`);
    }

    start(): void {
        // STEP 1: Register services (and any other components) used by the application
        this.registerComponents();
        this.log(`Services registered: ${Object.keys(this.components).join(', ')}`);

        // STEP 2: Define the application pipeline
        this.definePipeline();
        this.log('Pipeline defined');

        // STEP 3: Join a room based on the configuration (optionally creates a server)
        this.joinRoom();
    }

    registerComponents() {
        // An MediaReceiver to receive audio data from peers
        this.components.mediaReceiver = new MediaReceiver(this.scene);

        // A SpeechToTextService to transcribe audio coming from peers
        this.components.speech2text = new SpeechToTextService(this.scene);

        // A TextGenerationService to generate text based on text
        this.components.textGenerationService = new TextGenerationService(this.scene, this.activityId);

        // A TextToSpeechService to generate audio based on text
        this.components.textToSpeechService = new TextToSpeechService(this.scene);
    }

    definePipeline() {
        // Step 1: When we receive audio data from a peer we send it to the transcription service
        this.components.mediaReceiver?.on('audio', (uuid: string, data: RTCAudioData) => {
            const sampleBuffer = Buffer.from(data.samples.buffer);

            if (this.roomClient.peers.get(uuid) !== undefined) {
                this.components.speech2text?.sendToChildProcess(uuid, sampleBuffer);
            }
        });

        // Step 2: When we receive a response from the transcription service, we send it to the text generation service
        this.components.speech2text?.on('data', (data: Buffer, identifier: string) => {
            const peer = this.roomClient.peers.get(identifier);
            const peerName = peer?.properties.get('ubiq.displayname');

            let response = data.toString().replace(/(\r\n|\n|\r)/gm, '');
            
            if (response.startsWith('>')) {
                response = response.slice(1);
                if (response.trim()) {
                    const message = (peerName + ' -> Agent:: ' + response).trim();
                    this.log(message);

                    // Pass activityId with each message
                    this.components.textGenerationService?.sendToChildProcess(
                        'default',
                        message + '\n',
                        this.activityId
                    );
                }
            }
        });

        // Step 3: When we receive a response from the text generation service, send it to text to speech
        this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
            const response = data.toString();
            this.log('Received text generation response from child process ' + identifier + ': ' + response, 'info');

            // More robust parsing of response format that allows for variations
            const match = response.match(/-> ([^:]+):: (.*)/);
            
            if (!match || !match[1] || !match[2]) {
                this.log('Error parsing response format: ' + response, 'error');
                return;
            }

            this.targetPeer = match[1].trim();
            const message = match[2].trim();
            
            this.log(`Sending to TTS: "${message}" for target: ${this.targetPeer}`, 'info');
            
            // Ensure we're sending a properly formatted string to the TTS service
            if (message && message.length > 0) {
                this.components.textToSpeechService?.sendToChildProcess('default', message + '\n');
            } else {
                this.log('Empty message, not sending to TTS', 'warn');
            }
        });

        // Add diagnostic logging to the TTS service response
        this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
            this.log(`Received ${data.length} bytes of audio data from TTS service`, 'info');
            
            if (data.length === 0) {
                this.log('Warning: Empty audio data from TTS', 'warn');
                return;
            }

            this.scene.send(new NetworkId(95), {
                type: 'AudioInfo',
                targetPeer: this.targetPeer,
                audioLength: data.length,
            });

            let response = data;
            let chunks = 0;
            
            while (response.length > 0) {
                this.scene.send(new NetworkId(95), response.slice(0, 16000));
                response = response.slice(16000);
                chunks++;
            }
            
            this.log(`Sent ${chunks} audio chunks to peer ${this.targetPeer}`, 'info');
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
