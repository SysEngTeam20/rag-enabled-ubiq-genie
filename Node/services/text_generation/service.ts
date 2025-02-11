import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import nconf from 'nconf';

export class TextGenerationService extends ServiceController {
    private activityId: string;

    constructor(scene: NetworkScene, activityId: string) {
        super(scene, 'TextGenerationService');
        
        this.activityId = activityId;
        
        // Load .env.local file
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Get API base URL with default value
        const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
        const apiSecretKey = process.env.API_SECRET_KEY;
        
        if (!apiSecretKey) {
            this.log('Warning: API_SECRET_KEY not found in environment variables. Some features may not work.');
        }

        const pythonProcess = this.registerChildProcess('default', 'python', [
            '-u',
            path.join(path.dirname(fileURLToPath(import.meta.url)), 'rag_service.py'),
            '--preprompt',
            nconf.get('preprompt') || '',
            '--prompt_suffix',
            nconf.get('prompt_suffix') || '',
            '--api_base_url',
            apiBaseUrl,
            '--activity_id',
            this.activityId
        ]);

        // Handle stderr separately for debug messages
        if (pythonProcess.stderr) {
            pythonProcess.stderr.on('data', (data: Buffer) => {
                this.log(`Debug: ${data.toString().trim()}`);
            });
        }

        this.log(`TextGenerationService initialized for activity: ${this.activityId}`);
    }

    sendToChildProcess(identifier: string, message: string, activityId?: string) {
        // Verify activityId matches the service's activityId
        if (activityId && activityId !== this.activityId) {
            this.log(`Warning: Received message for activity ${activityId} but service is configured for ${this.activityId}`);
        }

        const messageObj = {
            content: message,
            activity_id: this.activityId
        };

        super.sendToChildProcess(identifier, JSON.stringify(messageObj) + '\n');
    }
}