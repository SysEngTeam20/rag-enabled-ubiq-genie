import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import WebSocket from 'ws';

export class TextToSpeechService extends ServiceController {
    private wsConnection: WebSocket | null = null;
    private readonly WS_SERVER = 'ws://localhost:5001/tts/ws';
    private reconnectAttempts = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 5;

    constructor(scene: NetworkScene) {
        super(scene, 'TextToSpeechService');
        this.setupWebSocket();
    }

    private setupWebSocket() {
        try {
            const clientId = Math.random().toString(36).substring(7);
            this.wsConnection = new WebSocket(`${this.WS_SERVER}/${clientId}`);

            this.wsConnection.on('open', () => {
                console.log('[TextToSpeechService] WebSocket connected');
                this.reconnectAttempts = 0;
            });

            this.wsConnection.on('message', (data: WebSocket.Data) => {
                if (data instanceof Buffer) {
                    this.emit('data', data, 'default');
                }
            });

            this.wsConnection.on('close', () => {
                console.log('[TextToSpeechService] WebSocket closed');
                this.attemptReconnect();
            });

            this.wsConnection.on('error', (error) => {
                console.error('[TextToSpeechService] WebSocket error:', error);
                this.attemptReconnect();
            });

        } catch (error) { 
            console.error('[TextToSpeechService] Error setting up WebSocket:', error);
        }
    }

    private attemptReconnect() {
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`[TextToSpeechService] Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(() => this.setupWebSocket(), 1000 * this.reconnectAttempts);
        }
    }

    async sendToChildProcess(identifier: string, text: string): Promise<boolean> {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            console.error('[TextToSpeechService] WebSocket not connected');
            return false;
        }

        try {
            this.wsConnection.send(JSON.stringify({ text }));
            return true;
        } catch (error) {
            console.error('[TextToSpeechService] Error sending text:', error);
            return false;
        }
    }
}
