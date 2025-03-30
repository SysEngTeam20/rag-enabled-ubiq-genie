import { NetworkScene } from 'ubiq';
import { RoomClient } from 'ubiq-server/components/roomclient.js';
import path from 'path';
import { spawn } from 'child_process';
import nconf from 'nconf';
import { UbiqTcpConnection, TcpConnectionWrapper } from 'ubiq-server/ubiq';
import { Logger } from './logger.js';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { RoomManager } from './room_manager.js';

export class ApplicationController {
    name!: string;
    scene!: NetworkScene;
    roomClient!: RoomClient;
    components!: { [key: string]: any };
    connection!: TcpConnectionWrapper;
    configPath: string;
    roomManager!: RoomManager;
    serverStarted: boolean = false;

    /**
     * Constructor for the ApplicationController class.
     *
     * @constructor
     * @memberof ApplicationController
     */
    constructor() {
        this.components = {}; // A dictionary of services used by the application
        const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../apps/server_config.json');
        Logger.log('ApplicationController', `Loading config from: ${configPath}`, 'info');
        nconf.file(configPath);
        
        // Create a new NetworkScene with proper initialization
        this.scene = new NetworkScene();
        
        try {
            // Add a TCP connection for WebRTC signaling
            Logger.log('ApplicationController', 'Setting up TCP connection for WebRTC signaling', 'info');
            
            // Get the port from config
            const portConfig = nconf.get('roomserver:tcp:port');
            const port = typeof portConfig === 'string' ? parseInt(portConfig, 10) : (portConfig || 8009);
            const uri = nconf.get('roomserver:uri') || 'localhost';
            Logger.log('ApplicationController', `Using TCP connection: ${uri}:${port}`, 'info');
            
            // Use the UbiqTcpConnection function (not a constructor)
            // UbiqTcpConnection already returns a TcpConnectionWrapper
            const tcpConnection = UbiqTcpConnection(uri, port);
            this.connection = tcpConnection; // No need to wrap it again
            
            // Connect the scene to the network
            Logger.log('ApplicationController', 'Connecting NetworkScene to TCP connection', 'info');
            this.scene.addConnection(tcpConnection);
            
            Logger.log('ApplicationController', 'Network connection established successfully', 'info');
        } catch (error) {
            Logger.log('ApplicationController', `ERROR setting up network connection: ${error}`, 'error');
        }
        
        // Initialize RoomManager
        this.roomManager = new RoomManager(this.scene);
        
        this.configPath = configPath;
        this.name = nconf.get('name');

        dotenv.config({ override: true });
        
        // Set up event handlers for room join requests
        this.setupRoomEventHandlers();
        
        Logger.log('ApplicationController', 'Application initialized', 'info');
    }

    /**
     * Logs a message to the console with the service name.
     *
     * @memberof ApplicationController
     * @param {string} message - The message to log.
     */
    log(message: string, level: 'info' | 'warning' | 'error' = 'info', end: string = '\n'): void {
        Logger.log(`\x1b[1m${this.name}\x1b[0m`, message, level, end, '\x1b[1m');
    }

    /**
     * Set up event handlers for room-related events
     */
    private setupRoomEventHandlers(): void {
        // Listen for room join requests
        this.scene.on('roomJoinRequest', (data: any) => {
            const sceneId = data.sceneId;
            const requestId = data.requestId;
            const peerId = data.peerId;
            
            Logger.log('ApplicationController', `Received join request for scene ${sceneId} from peer ${peerId}`, 'info');
            
            // Create or get the room
            const room = this.roomManager.getOrCreateRoom(sceneId);
            
            // Initialize the conversational agent if it doesn't exist
            if (!room.getAgent()) {
                room.initAgent();
            }
            
            // Respond to the join request
            this.scene.emit('roomJoinResponse', {
                requestId: requestId,
                sceneId: sceneId,
                success: true
            });
            
            Logger.log('ApplicationController', `Joined room ${sceneId} for peer ${peerId}`, 'info');
        });
    }

    /**
     * Join a room and create a conversational agent.
     * 
     * @param roomId The ID of the room to join.
     * @param startServer Whether to start the Ubiq server if not already started.
     * @returns The ID of the room that was joined.
     */
    async joinRoom(roomId: string, startServer: boolean = true): Promise<string> {
        try {
            Logger.log('ApplicationController', `Joining room: ${roomId}`, 'info');
            
            // Add WebRTC diagnostic log
            Logger.log('ApplicationController', 'DIAGNOSTICS: Checking WebRTC setup...', 'info');
            
            // Check if the wrtc package is available
            try {
                const wrtc = await import('@roamhq/wrtc');
                Logger.log('ApplicationController', `WebRTC package loaded successfully: ${!!wrtc}`, 'info');
                Logger.log('ApplicationController', `RTCPeerConnection available: ${!!wrtc.default.RTCPeerConnection}`, 'info');
            } catch (error) {
                Logger.log('ApplicationController', `ERROR loading WebRTC package: ${error}`, 'error');
            }
            
            // Start the server if needed and not already started
            if (startServer && !this.serverStarted) {
                Logger.log('ApplicationController', 'Starting Ubiq server...', 'info');
                
                // Use the class's own startServer method with the config path
                await this.startServer(this.configPath);
                this.serverStarted = true;
                Logger.log('ApplicationController', 'Ubiq server started successfully', 'info');
            }
            
            // Create a new RoomClient for this specific room join
            Logger.log('ApplicationController', 'Creating new RoomClient...', 'info');
            const roomClient = new RoomClient(this.scene);
            this.roomClient = roomClient; // Store at class level for later reference
            
            // Pass the room client to the RoomManager
            Logger.log('ApplicationController', 'Setting room client on RoomManager', 'info');
            this.roomManager.setRoomClient(roomClient);
            
            // Join the room - VERIFY THE JOIN HAPPENS!
            Logger.log('ApplicationController', `Joining room with ID: ${roomId}`, 'info');
            roomClient.join(roomId);
            
            // Force a delay before polling room state to ensure join completes
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Verify the room join was successful
            if (roomClient) {
                // Try to access different properties to find the current room ID
                const joinedRoomId = (roomClient as any).roomId ||
                                    ((roomClient as any).room?.uuid) ||
                                    ((roomClient as any).room?.id) ||
                                    ((roomClient as any).guid && typeof (roomClient as any).guid === 'function' ? (roomClient as any).guid() : null);
                
                if (joinedRoomId && joinedRoomId !== roomId) {
                    Logger.log('ApplicationController', `WARNING: Joined room ${joinedRoomId} but requested ${roomId}`, 'warning');
                } else if (!joinedRoomId) {
                    Logger.log('ApplicationController', `ERROR: Failed to join room ${roomId}, no room ID found after join`, 'error');
                    
                    // Try forcing the room ID on the client as a last resort
                    Logger.log('ApplicationController', 'Attempting to force room ID...', 'info');
                    if ((roomClient as any).room) {
                        (roomClient as any).room.uuid = roomId;
                    }
                    
                    // Try calling join again
                    Logger.log('ApplicationController', 'Retrying room join...', 'info');
                    roomClient.join(roomId);
                } else {
                    Logger.log('ApplicationController', `Successfully joined room: ${joinedRoomId}`, 'info');
                }
            }
            
            // Log the peers in the room after joining
            setTimeout(() => {
                if (roomClient && roomClient.peers) {
                    const peerCount = roomClient.peers.size;
                    const peerIds = Array.from(roomClient.peers.keys());
                    Logger.log('ApplicationController', `After joining: Room has ${peerCount} peers: [${peerIds.join(', ')}]`, 'info');
                    
                    // Force agent initialization if it hasn't happened yet
                    const roomInstance = this.roomManager.getRoom(roomId);
                    if (roomInstance) {
                        Logger.log('ApplicationController', `Room instance exists, forcing agent initialization`, 'info');
                        roomInstance.initAgent();
                    } else {
                        Logger.log('ApplicationController', `No room instance found, creating one`, 'info');
                        this.roomManager.addRoom(roomId);
                    }
                }
            }, 3000); // Check after 3 seconds to allow connections to establish
            
            return roomId;
        } catch (error) {
            Logger.log('ApplicationController', `Error joining room: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Starts a Ubiq server with the specified configuration files.
     *
     * @memberof ApplicationController
     * @param configFiles An array of configuration files to pass to the server
     */
    async startServer(configPath?: string): Promise<void> {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const ubiqPath = path.resolve(__dirname, '..', 'node_modules', 'ubiq-server');

        // First ensure the server is installed
        try {
            await new Promise((resolve, reject) => {
                const install = spawn('npm', ['install'], {
                    stdio: 'inherit',
                    cwd: ubiqPath,
                    shell: true
                });
                install.on('close', (code) => {
                    if (code === 0) resolve(undefined);
                    else reject(new Error(`npm install failed with code ${code}`));
                });
            });
        } catch (error) {
            Logger.log('ApplicationController', `Failed to install ubiq-server dependencies: ${error}`, 'error');
            throw error;
        }

        // Then start the server
        const params = ['start'];
        if (configPath) {
            const absConfigPath = path.resolve(__dirname, configPath);
            params.push(absConfigPath);
        }

        const child = spawn('npm', params, {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            cwd: ubiqPath,
            shell: true,
        });

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                process.stderr.write(`\x1b[31m[Ubiq Server]\x1b[0m ${data}`);
            });
        }

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                process.stdout.write(`\x1b[32m[Ubiq Server]\x1b[0m ${data}`);
            });
        }

        // Wait for the child process to print "Added RoomServer port" before returning
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for Ubiq server to start'));
            }, 30000); // 30 second timeout

            child.stdout?.on('data', (data) => {
                if (data.toString().includes('Added RoomServer port')) {
                    clearTimeout(timeout);
                    resolve();
                }
            });

            child.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            child.on('exit', (code) => {
                if (code !== 0) {
                    clearTimeout(timeout);
                    reject(new Error(`Ubiq server exited with code ${code}`));
                }
            });
        });
    }

    /**
     * Initialize the application in server mode without joining a specific room.
     * This allows the server to wait for incoming room join requests.
     */
    async initializeServer(): Promise<void> {
        try {
            Logger.log('ApplicationController', 'Initializing application in server mode', 'info');
            
            // Start the server if not already started
            if (!this.serverStarted) {
                Logger.log('ApplicationController', 'Starting Ubiq server...', 'info');
                
                // Use the class's own startServer method with the config path
                await this.startServer(this.configPath);
                this.serverStarted = true;
                Logger.log('ApplicationController', 'Ubiq server started successfully', 'info');
            }
            
            // Create a room client without joining a specific room
            const roomClient = new RoomClient(this.scene);
            this.roomClient = roomClient;
            
            // Pass the room client to the RoomManager
            Logger.log('ApplicationController', 'Setting room client on RoomManager', 'info');
            this.roomManager.setRoomClient(roomClient);
            
            // Set up monitoring for server logs to detect room creation
            this.monitorServerLogs();
            
            // Now the server is ready to accept incoming room join requests
            Logger.log('ApplicationController', 'Server initialized and ready for incoming room joins', 'info');
        } catch (error) {
            Logger.log('ApplicationController', `Error initializing server: ${error}`, 'error');
            throw error;
        }
    }
    
    /**
     * Monitor stdout to detect when rooms are created by the Ubiq server
     */
    private monitorServerLogs(): void {
        try {
            // Add listeners to stdout to catch room creation events
            const originalStdoutWrite = process.stdout.write;
            
            // Override stdout.write to monitor for room creation
            // @ts-ignore: We need to override the function to intercept logs
            process.stdout.write = function(
                this: NodeJS.WriteStream,
                chunk: string | Uint8Array,
                encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
                callback?: (err?: Error) => void
            ): boolean {
                const output = typeof chunk === 'string' 
                    ? chunk 
                    : chunk.toString();
                
                // Detect room creation events in log messages
                if (output.includes('created with joincode')) {
                    const appController = global.appController as ApplicationController;
                    if (appController) {
                        appController.handleRoomCreationDetected(output);
                    }
                }
                
                // Detect room join events
                if (output.includes('joined room')) {
                    const appController = global.appController as ApplicationController;
                    if (appController) {
                        appController.handleRoomJoinDetected(output);
                    }
                }
                
                // Call the original write function
                return originalStdoutWrite.apply(this, arguments as any);
            };
            
            // Store a reference to this application controller in global
            (global as any).appController = this;
            
            Logger.log('ApplicationController', 'Server log monitoring activated', 'info');
        } catch (error) {
            Logger.log('ApplicationController', `Error setting up log monitoring: ${error}`, 'error');
        }
    }
    
    /**
     * Handle detection of room creation from logs
     */
    public handleRoomCreationDetected(logMessage: string): void {
        try {
            // Extract the room GUID from the log message
            // Example: "34db635d-94ea-45c3-afb6-b81fc5e6c33e created with joincode c3l"
            const regex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) created with joincode/i;
            const match = regex.exec(logMessage);
            
            if (match && match[1]) {
                const roomId = match[1];
                Logger.log('ApplicationController', `Detected room creation from logs: ${roomId}`, 'info');
                
                // Create the room instance and agent
                const roomInstance = this.roomManager.getOrCreateRoom(roomId);
                
                // Force agent initialization
                if (!roomInstance.getAgent()) {
                    Logger.log('ApplicationController', `Room instance exists, forcing agent initialization`, 'info');
                    roomInstance.initAgent();
                } else {
                    Logger.log('ApplicationController', `Room instance already exists, not forcing agent initialization`, 'info');
                }
            }
        } catch (error) {
            Logger.log('ApplicationController', `Error handling room creation detection: ${error}`, 'error');
        }
    }
    
    /**
     * Handle detection of room join from logs
     */
    public handleRoomJoinDetected(logMessage: string): void {
        try {
            // Extract the room GUID from the log message
            // Example: "34db635d-94ea-45c3-afb6-b81fc5e6c33e joined room"
            const regex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) joined room/i;
            const match = regex.exec(logMessage);
            
            if (match && match[1]) {
                const roomId = match[1];
                Logger.log('ApplicationController', `Detected room join from logs: ${roomId}`, 'info');
                
                // Create the room instance and agent
                const roomInstance = this.roomManager.getOrCreateRoom(roomId);
                
                // Force agent initialization
                if (!roomInstance.getAgent()) {
                    Logger.log('ApplicationController', `Room instance exists, forcing agent initialization`, 'info');
                    roomInstance.initAgent();
                } else {
                    Logger.log('ApplicationController', `Room instance already exists, not forcing agent initialization`, 'info');
                }
            }
        } catch (error) {
            Logger.log('ApplicationController', `Error handling room join detection: ${error}`, 'error');
        }
    }
}