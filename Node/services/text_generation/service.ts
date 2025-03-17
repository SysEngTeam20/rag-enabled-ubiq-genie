import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import nconf from 'nconf';
import { ChildProcess, spawn } from 'child_process';

export class TextGenerationService extends ServiceController {
    private activityId: string;
    childProcesses: Record<string, ChildProcess> = {};

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

    public sendToChildProcess(identifier: string, data: Buffer, activityId?: string): boolean {
        // Ensure child process exists
        if (!this.childProcesses[identifier]) {
            this.log(`Creating new text generation process for ${identifier}`, 'warning');
            const child = this.initChildProcess(identifier);
            if (!child) {
                this.log(`Failed to create text generation process for ${identifier}`, 'error');
                return false;
            }
            this.childProcesses[identifier] = child;
        }

        // Add activity ID to the message payload
        const payload = activityId 
            ? `${data.toString()}[ACTIVITY:${activityId}]`
            : data.toString();

        const result = super.sendToChildProcess(identifier, Buffer.from(payload));
        return result !== undefined ? result : false;
    }

    private initChildProcess(identifier: string): ChildProcess | null {
        try {
            const scriptPath = path.join(__dirname, 'text_generation.py');
            this.log(`Starting text generation process: ${scriptPath}`);
            
            const child = spawn('python3', [scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            child.stderr?.on('data', (data) => {
                this.emit('error', new Error(`TextGen Error: ${data.toString()}`));
            });

            return child;
        } catch (error: any) {
            this.log(`Failed to start text generation process: ${error.message}`, 'error');
            return null;
        }
    }
}