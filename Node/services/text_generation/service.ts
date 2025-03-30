import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import nconf from 'nconf';
import { ChildProcess, spawn } from 'child_process';
import { Logger } from '../../components/logger';

export class TextGenerationService extends ServiceController {
    private sceneId: string;
    childProcesses: Record<string, ChildProcess> = {};

    constructor(scene: NetworkScene, sceneId: string) {
        super(scene, 'TextGenerationService');
        
        this.sceneId = sceneId;
        
        // Load .env.local file
        dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
        
        // Get API base URL with default value
        const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
        const apiSecretKey = process.env.API_SECRET_KEY;
        
        if (!apiSecretKey) {
            Logger.log('TextGenerationService', 'Warning: API_SECRET_KEY not found in environment variables. Some features may not work.', 'warning');
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
            '--scene_id',
            this.sceneId
        ]);

        // Log process details
        Logger.log('TextGenerationService', 'Python process details:', 'info');
        Logger.log('TextGenerationService', `  - PID: ${pythonProcess.pid}`, 'info');
        Logger.log('TextGenerationService', `  - Script: ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'rag_service.py')}`, 'info');
        Logger.log('TextGenerationService', `  - Scene ID: ${this.sceneId}`, 'info');

        // Handle stdout for responses
        if (pythonProcess.stdout) {
            pythonProcess.stdout.on('data', (data: Buffer) => {
                const response = data.toString().trim();
                if (response && response.length > 0) {
                    Logger.log('TextGenerationService', `Received response of length ${response.length} characters`, 'info');
                    this.emit('data', data, 'default');
                }
            });
        }

        // Handle stderr separately for debug messages
        if (pythonProcess.stderr) {
            pythonProcess.stderr.on('data', (data: Buffer) => {
                const debugMsg = data.toString().trim();
                if (debugMsg && !debugMsg.includes('Received empty line') && !debugMsg.includes('Received 0 bytes')) {
                    Logger.log('TextGenerationService', `Python process output: ${debugMsg}`, 'info');
                }
            });
        }

        // Handle process errors
        pythonProcess.on('error', (error: Error) => {
            Logger.log('TextGenerationService', `Process error: ${error.message}`, 'error');
        });

        pythonProcess.on('exit', (code: number) => {
            Logger.log('TextGenerationService', `Process exited with code ${code}`, 'info');
        });

        // Add startup check
        setTimeout(() => {
            if (pythonProcess.killed) {
                Logger.log('TextGenerationService', 'Python process died during startup', 'error');
            } else {
                Logger.log('TextGenerationService', 'Python process startup check successful', 'info');
            }
        }, 5000);

        Logger.log('TextGenerationService', `Service initialized for scene: ${this.sceneId}`, 'info');
    }

    public async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        const process = this.childProcesses[identifier];
        if (!process) {
            Logger.log('TextGenerationService', `No child process found for identifier: ${identifier}`, 'error');
            return false;
        }

        // Verify process is running and connected
        if (process.killed || !process.stdin) {
            Logger.log('TextGenerationService', `Process ${identifier} is not running or stdin is not available`, 'error');
            return false;
        }

        try {
            // Format the message as JSON
            const message = {
                content: data.toString().trim(),
                sceneId: this.sceneId,
                peerName: data.toString().trim().split(' -> ')[0] // Extract peer name from the message
            };
            
            // Log the exact payload being sent
            Logger.log('TextGenerationService', `Writing payload to stdin: ${JSON.stringify(message).length} bytes`, 'info');

            // Write to stdin without ending the stream
            const stdin = process.stdin;
            const jsonStr = JSON.stringify(message) + '\n';
            stdin.write(jsonStr);
            
            // Wait for the write to complete
            await new Promise((resolve) => {
                stdin.once('drain', resolve);
            });

            Logger.log('TextGenerationService', 'Successfully wrote to process stdin', 'info');
            return true;
        } catch (error) {
            Logger.log('TextGenerationService', `Error writing to process ${identifier}: ${error}`, 'error');
            return false;
        }
    }

    /**
     * Helper method to send a message to the RAG service
     * @param message The message to send
     * @returns true if successful, false otherwise
     */
    public async sendMessage(message: string): Promise<boolean> {
        return this.sendToChildProcess('default', Buffer.from(message));
    }

    /**
     * Clean up resources when this service is no longer needed
     */
    public cleanup(): void {
        Logger.log('TextGenerationService', `Cleaning up service for scene: ${this.sceneId}`, 'info');
        
        // Terminate all child processes
        Object.entries(this.childProcesses).forEach(([identifier, process]) => {
            try {
                if (!process.killed) {
                    Logger.log('TextGenerationService', `Terminating process for ${identifier}`, 'info');
                    process.kill();
                }
            } catch (error) {
                Logger.log('TextGenerationService', `Error terminating process for ${identifier}: ${error}`, 'error');
            }
        });
        
        // Clear the processes map
        this.childProcesses = {};
        
        // Remove all listeners
        this.removeAllListeners();
        
        Logger.log('TextGenerationService', 'Cleanup complete', 'info');
    }
}