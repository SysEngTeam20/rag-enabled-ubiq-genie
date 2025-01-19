import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import nconf from 'nconf';
import * as dotenv from 'dotenv';
import path from 'path';

class TextGenerationService extends ServiceController {
    private currentActivityId: string | null = null;

    constructor(scene: NetworkScene) {
        super(scene, 'TextGenerationService');
        
        // Load .env.local file
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Ensure required environment variables are present
        if (!process.env.API_SECRET_KEY) {
            throw new Error('API_SECRET_KEY environment variable is required');
        }
        
        const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
        
        this.registerChildProcess('default', 'python', [
            '-u',
            '../../services/text_generation/rag_service.py',
            '--preprompt',
            nconf.get('preprompt') || '',
            '--prompt_suffix',
            nconf.get('prompt_suffix') || '',
            '--api_base_url',
            apiBaseUrl
        ]);
    }

    sendToChildProcess(identifier: string, message: string, activityId?: string) {
        if (activityId) {
            this.currentActivityId = activityId;
        }

        const messageObj = {
            content: message,
            activity_id: this.currentActivityId
        };

        super.sendToChildProcess(identifier, JSON.stringify(messageObj) + '\n');
    }
}

export { TextGenerationService };