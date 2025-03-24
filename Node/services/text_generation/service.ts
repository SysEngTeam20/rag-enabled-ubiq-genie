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

        // Log process details
        console.log('[TextGenerationService] Python process details:', {
            pid: pythonProcess.pid,
            script: path.join(path.dirname(fileURLToPath(import.meta.url)), 'rag_service.py'),
            args: [
                '--preprompt', nconf.get('preprompt') || '',
                '--prompt_suffix', nconf.get('prompt_suffix') || '',
                '--api_base_url', apiBaseUrl,
                '--activity_id', this.activityId
            ],
            workingDirectory: process.cwd()
        });

        // Handle stdout for responses
        if (pythonProcess.stdout) {
            pythonProcess.stdout.on('data', (data: Buffer) => {
                const response = data.toString().trim();
                if (response && response.length > 0) {
                    console.log(`[TextGenerationService] Received response:`, {
                        content: response,
                        length: response.length,
                        timestamp: new Date().toISOString(),
                        hasContent: response.length > 0,
                        startsWithAgent: response.startsWith('Agent ->')
                    });
                    this.emit('data', data, 'default');
                }
            });
        }

        // Handle stderr separately for debug messages
        if (pythonProcess.stderr) {
            pythonProcess.stderr.on('data', (data: Buffer) => {
                const debugMsg = data.toString().trim();
                if (debugMsg && !debugMsg.includes('Received empty line') && !debugMsg.includes('Received 0 bytes')) {
                    console.log(`[TextGenerationService] Python process output:`, {
                        message: debugMsg,
                        timestamp: new Date().toISOString(),
                        processState: {
                            pid: pythonProcess.pid,
                            killed: pythonProcess.killed,
                            connected: pythonProcess.connected,
                            exitCode: pythonProcess.exitCode
                        }
                    });
                }
            });
        }

        // Handle process errors
        pythonProcess.on('error', (error: Error) => {
            console.error(`[TextGenerationService] Process error:`, {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString(),
                processState: {
                    pid: pythonProcess.pid,
                    killed: pythonProcess.killed,
                    connected: pythonProcess.connected,
                    exitCode: pythonProcess.exitCode
                }
            });
        });

        pythonProcess.on('exit', (code: number) => {
            console.log(`[TextGenerationService] Process exited:`, {
                code,
                timestamp: new Date().toISOString(),
                processState: {
                    pid: pythonProcess.pid,
                    killed: pythonProcess.killed,
                    connected: pythonProcess.connected,
                    exitCode: pythonProcess.exitCode
                }
            });
        });

        // Add startup check
        setTimeout(() => {
            if (pythonProcess.killed) {
                console.error('[TextGenerationService] Python process died during startup');
            } else {
                console.log('[TextGenerationService] Python process startup check:', {
                    pid: pythonProcess.pid,
                    killed: pythonProcess.killed,
                    connected: pythonProcess.connected,
                    exitCode: pythonProcess.exitCode,
                    timestamp: new Date().toISOString()
                });
            }
        }, 5000);

        this.log(`TextGenerationService initialized for activity: ${this.activityId}`);
    }

    public async sendToChildProcess(identifier: string, data: Buffer): Promise<boolean> {
        const process = this.childProcesses[identifier];
        if (!process) {
            console.error(`[TextGenerationService] No child process found for identifier: ${identifier}`);
            return false;
        }

        // Log detailed process state
        console.log('[TextGenerationService] Process state:', {
            pid: process.pid,
            killed: process.killed,
            connected: process.connected,
            stdin: !!process.stdin,
            stdout: !!process.stdout,
            stderr: !!process.stderr,
            exitCode: process.exitCode,
            timestamp: new Date().toISOString()
        });

        // Verify process is running and connected
        if (process.killed || !process.stdin) {
            console.error(`[TextGenerationService] Process ${identifier} is not running or stdin is not available`);
            return false;
        }

        try {
            // Log the exact payload being sent
            const payload = data.toString();
            console.log('[TextGenerationService] Writing payload to stdin:', {
                payload,
                length: payload.length,
                timestamp: new Date().toISOString()
            });

            // Write to stdin and ensure it's flushed
            const stdin = process.stdin;
            stdin.write(payload + '\n');
            stdin.end();

            // Wait for the write to complete
            await new Promise((resolve) => {
                stdin.once('drain', resolve);
            });

            console.log('[TextGenerationService] Successfully wrote to process stdin');
            return true;
        } catch (error) {
            console.error(`[TextGenerationService] Error writing to process ${identifier}:`, error);
            return false;
        }
    }

    private async verifyProcessStartup(identifier: string): Promise<boolean> {
        const process = this.childProcesses[identifier];
        if (!process) return false;

        // Wait for process to be ready
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check process state
        const state = {
            pid: process.pid,
            killed: process.killed,
            connected: process.connected,
            exitCode: process.exitCode,
            timestamp: new Date().toISOString()
        };

        console.log('[TextGenerationService] Python process startup check:', state);

        return !process.killed && process.exitCode === null;
    }

    private initChildProcess(identifier: string): ChildProcess | null {
        try {
            const scriptPath = path.join(__dirname, 'text_generation.py');
            this.log(`Starting text generation process: ${scriptPath}`);
            
            const child = spawn('python3', [scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            console.log('[TextGenerationService] Child process created:', {
                identifier,
                pid: child.pid,
                connected: child.connected
            });

            child.stderr?.on('data', (data) => {
                const errorMsg = data.toString().trim();
                console.error(`[TextGenerationService] Child process error:`, {
                    identifier,
                    error: errorMsg,
                    timestamp: new Date().toISOString()
                });
                this.emit('error', new Error(`TextGen Error: ${errorMsg}`));
            });

            child.on('exit', (code) => {
                console.log(`[TextGenerationService] Child process exited:`, {
                    identifier,
                    code,
                    timestamp: new Date().toISOString()
                });
            });

            return child;
        } catch (error: any) {
            this.log(`Failed to start text generation process: ${error.message}`, 'error');
            return null;
        }
    }
}