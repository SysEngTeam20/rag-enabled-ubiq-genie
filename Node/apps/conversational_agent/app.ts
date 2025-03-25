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
        this.components.mediaReceiver = new MediaReceiver(this.scene);
        this.components.speech2text = new SpeechToTextService(this.scene, 'SpeechToTextService', this.activityId);
        this.components.textGenerationService = new TextGenerationService(this.scene, this.activityId);
        this.components.textToSpeechService = new TextToSpeechService(this.scene);
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
            console.log(`Received STT data: ${data.toString()}`);
            const peer = this.roomClient.peers.get(identifier);
            const peerName = peer?.properties.get('ubiq.displayname') || 'User';
            let response = data.toString().trim();

            if (response.startsWith('>')) {
                response = response.slice(1).trim();
                if (response) {
                    const message = `${peerName} -> Agent:: ${response}`;
                    console.log(`Sending to text generation: ${message}`);
                    this.components.textGenerationService?.sendToChildProcess('default', Buffer.from(message + '\n'));
                }
            }
        });

        this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
            console.log(`Received text generation: ${data.toString()}`);
            const response = data.toString().trim();
            const [, name, message] = response.match(/-> (.*?):: (.*)/) || [];

            if (name && message) {
                this.targetPeer = name.trim();
                console.log(`Sending to TTS: ${message}`);
                this.components.textToSpeechService?.sendToChildProcess('default', message.trim() + '\n');
            }
        });

        this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
            if (data.length > 0) {
                console.log(`Received TTS audio, length: ${data.length}`);
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

