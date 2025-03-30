import { NetworkId, NetworkScene } from 'ubiq';
import { RoomClient } from 'ubiq-server/components/roomclient.js';
import { TextToSpeechService } from '../../services/text_to_speech/service';
import { SpeechToTextService } from '../../services/speech_to_text/service';
import { TextGenerationService } from '../../services/text_generation/service';
import { MediaReceiver } from '../../components/media_receiver';
import path from 'path';
import { RTCAudioData } from '@roamhq/wrtc/types/nonstandard';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';
import nconf from 'nconf';
import { Logger } from '../../components/logger';

// Replace the dynamic import helper with a proper async function
async function dynamicImport(modulePath: string): Promise<any> {
  try {
    // Try direct import (works for npm packages and absolute paths)
    const module = await import(modulePath);
    Logger.log('ConversationalAgent', `Successfully imported ${modulePath}`, 'info');
    return module.default || module;
  } catch (firstError) {
    try {
      // Try a relative path from the current directory
      const relativeImportPath = `../../${modulePath}`; 
      const module = await import(relativeImportPath);
      Logger.log('ConversationalAgent', `Successfully imported ${modulePath} via relative path`, 'info');
      return module.default || module;
    } catch (secondError) {
      // Try with a third approach using a path from the project root
      try {
        const projectRootPath = `../../../${modulePath}`;
        const module = await import(projectRootPath);
        Logger.log('ConversationalAgent', `Successfully imported ${modulePath} via project root path`, 'info');
        return module.default || module;
      } catch (thirdError) {
        Logger.log('ConversationalAgent', `Failed to import ${modulePath}: ${(thirdError as Error).message}`, 'error');
        return null;
      }
    }
  }
}

// Initialize PeerConnectionManager asynchronously
let PeerConnectionManager: any = null;

// Use the import function without IIFE
Promise.all([
  // Try various possible paths for the PeerConnectionManager
  dynamicImport('ubiq-server/components/peerconnectionmanager.js'),
  dynamicImport('ubiq/server/components/peerconnectionmanager'),
  dynamicImport('components/peerconnectionmanager'),  
  dynamicImport('../../components/peerconnectionmanager'),
  dynamicImport('../../server/components/peerconnectionmanager')
])
.then(([module1, module2, module3, module4, module5]) => {
  // Find the first non-null module
  PeerConnectionManager = module1 || module2 || module3 || module4 || module5;
  
  if (PeerConnectionManager) {
    // Log which module path succeeded
    let successPath = "unknown";
    if (module1) successPath = "ubiq-server/components/peerconnectionmanager.js";
    else if (module2) successPath = "ubiq/server/components/peerconnectionmanager";
    else if (module3) successPath = "components/peerconnectionmanager";
    else if (module4) successPath = "../../components/peerconnectionmanager";
    else if (module5) successPath = "../../server/components/peerconnectionmanager";
    
    Logger.log('ConversationalAgent', `Successfully imported PeerConnectionManager from: ${successPath}`, 'info');
  } else {
    // Create a fallback mock implementation - using the same robust class
    PeerConnectionManager = class MockPeerConnectionManager {
      private scene: any;
      private connections: Map<string, any> = new Map();
      private eventListeners: Map<string, Function[]> = new Map();
      
      constructor(scene: any) {
        Logger.log('ConversationalAgent', 'Using emergency fallback PeerConnectionManager implementation', 'warning');
        this.scene = scene;
        
        // Try to register with scene for events
        if (scene && typeof scene.on === 'function') {
          scene.on('peerconnection', (data: any) => {
            this.handlePeerConnection(data);
          });
        }
      }
      
      createPeerConnection(peerId: string) {
        Logger.log('ConversationalAgent', `Creating mock peer connection for ${peerId}`, 'info');
        
        // Create a mock connection object
        const connection = {
          peerId,
          isConnected: true,
          localDescription: { type: 'offer', sdp: 'mock-sdp' },
          remoteDescription: null
        };
        
        this.connections.set(peerId, connection);
        
        // Emit connection event
        this.emitEvent('peerconnection', { peerId, connection });
        
        return connection;
      }
      
      addEventListener(event: string, callback: Function) {
        Logger.log('ConversationalAgent', `Adding event listener for ${event}`, 'info');
        
        if (!this.eventListeners.has(event)) {
          this.eventListeners.set(event, []);
        }
        
        this.eventListeners.get(event)?.push(callback);
      }
      
      removeEventListener(event: string, callback: Function) {
        if (!this.eventListeners.has(event)) return;
        
        const listeners = this.eventListeners.get(event);
        if (!listeners) return;
        
        const index = listeners.indexOf(callback);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      }
      
      private emitEvent(event: string, data: any) {
        const listeners = this.eventListeners.get(event) || [];
        
        for (const listener of listeners) {
          try {
            listener(data);
        } catch (error) {
            Logger.log('ConversationalAgent', `Error in event listener: ${(error as Error).message}`, 'error');
          }
        }
        
        // Also try to emit through scene if available
        if (this.scene && typeof this.scene.emit === 'function') {
          try {
            this.scene.emit(event, data);
          } catch (error) {
            // Ignore errors from scene.emit
          }
        }
      }
      
      private handlePeerConnection(data: any) {
        const { peerId } = data;
        
        if (peerId && !this.connections.has(peerId)) {
          this.createPeerConnection(peerId);
        }
      }
    };
    Logger.log('ConversationalAgent', 'Using mock PeerConnectionManager', 'warning');
  }
})
.catch(error => {
  Logger.log('ConversationalAgent', `Error initializing PeerConnectionManager: ${error}`, 'error');
  
  // Create a fallback mock implementation - using the same robust class
  PeerConnectionManager = class MockPeerConnectionManager {
    private scene: any;
    private connections: Map<string, any> = new Map();
    private eventListeners: Map<string, Function[]> = new Map();
    
    constructor(scene: any) {
      Logger.log('ConversationalAgent', 'Using emergency fallback PeerConnectionManager implementation', 'warning');
      this.scene = scene;
      
      // Try to register with scene for events
      if (scene && typeof scene.on === 'function') {
        scene.on('peerconnection', (data: any) => {
          this.handlePeerConnection(data);
        });
      }
    }
    
    createPeerConnection(peerId: string) {
      Logger.log('ConversationalAgent', `Creating mock peer connection for ${peerId}`, 'info');
      
      // Create a mock connection object
      const connection = {
        peerId,
        isConnected: true,
        localDescription: { type: 'offer', sdp: 'mock-sdp' },
        remoteDescription: null
      };
      
      this.connections.set(peerId, connection);
      
      // Emit connection event
      this.emitEvent('peerconnection', { peerId, connection });
      
      return connection;
    }
    
    addEventListener(event: string, callback: Function) {
      Logger.log('ConversationalAgent', `Adding event listener for ${event}`, 'info');
      
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      
      this.eventListeners.get(event)?.push(callback);
    }
    
    removeEventListener(event: string, callback: Function) {
      if (!this.eventListeners.has(event)) return;
      
      const listeners = this.eventListeners.get(event);
      if (!listeners) return;
      
      const index = listeners.indexOf(callback);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    
    private emitEvent(event: string, data: any) {
      const listeners = this.eventListeners.get(event) || [];
      
      for (const listener of listeners) {
        try {
          listener(data);
            } catch (error) {
          Logger.log('ConversationalAgent', `Error in event listener: ${(error as Error).message}`, 'error');
        }
        }
        
      // Also try to emit through scene if available
      if (this.scene && typeof this.scene.emit === 'function') {
            try {
          this.scene.emit(event, data);
            } catch (error) {
          // Ignore errors from scene.emit
        }
      }
    }
    
    private handlePeerConnection(data: any) {
      const { peerId } = data;
      
      if (peerId && !this.connections.has(peerId)) {
        this.createPeerConnection(peerId);
      }
    }
  };
});

export class ConversationalAgent extends EventEmitter {
    components: {
        mediaReceiver?: MediaReceiver;
        speech2text?: SpeechToTextService;
        textGenerationService?: TextGenerationService;
        textToSpeechService?: TextToSpeechService;
    } = {};
    targetPeer: string = '';
    private sceneId: string;
    private scene: NetworkScene;
    private roomClient: RoomClient;
    private lastProcessedTime: { [key: string]: number } = {};
    private readonly COOLDOWN_MS = 1000; // 1 seconds between processing
    private readonly AMPLITUDE_THRESHOLD = 50; // Lower threshold to detect speech more easily
    private readonly MIN_DURATION_MS = 200; // Minimum speech duration
    private readonly SILENCE_THRESHOLD_MS = 1000; // Reduced silence time before processing speech
    private speechStartTime: { [key: string]: number } = {};
    private speechBuffer: { [key: string]: Buffer[] } = {};
    private lastSpeechTime: { [key: string]: number } = {};
    private lastTTSMessage: string = '';
    private lastTTSTime: number = 0;
    private isStarted: boolean = false;
    private peerConnectionManager: any = null; // Add the peerConnectionManager property
    private roomJoinCode: string = '0'; // Default join code
    private lastAudioDataTime: number | null = null;

    // Wake word patterns
    private readonly WAKE_WORDS = [
        'hi', 'hey', 'ok', 'hello', 'yo', 'greetings', 'alright', 'well', 'so', 'now',
        'excuse me', 'can you', 'could you', 'would you', 'please', 'may i',
        'listen', 'tell me', 'help', 'assist', 'what is', 'how to', 'i need', 'i want'
    ];
    private readonly GENIE_VARIATIONS = [
        'genie', 'jeannie', 'jeanie', 'jeany', 'jeeny', 'jeani', 'jeane', 'jeanee', 'jeannie', 'jeanni', 
        'jinnie', 'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'jimmy',
        'jini', 'jiny', 'jinee', 'jene', 'jenea', 'jenei', 'jene', 'gini', 'allen', 'alan', 'allan', 'alen',
        'gini', 'genie', 'geny', 'jenny', 'jeny', 'ginny', 'assistant', 'agent', 'ai', 'computer', 'bot',
        'g', 'gene', 'jen', 'jin', 'gen', 'genius', 'genies'
    ];

    constructor(scene: NetworkScene, roomClient: RoomClient, sceneId: string) {
        super();
        
        try {
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
            Logger.log('ConversationalAgent', `CONSTRUCTING AGENT FOR SCENE: ${sceneId}`, 'info');
            
            // Initialize configuration
            const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
            Logger.log('ConversationalAgent', `Loading config from: ${configPath}`, 'info');
            nconf.file(configPath);
            
            const envPath = path.resolve(process.cwd(), '.env.local');
            Logger.log('ConversationalAgent', `Loading environment from: ${envPath}`, 'info');
            dotenv.config({ path: envPath });
            
        this.scene = scene;
        this.roomClient = roomClient;
            this.sceneId = sceneId;
            
            // Log some context info
            Logger.log('ConversationalAgent', `Scene valid: ${!!this.scene}`, 'info');
            Logger.log('ConversationalAgent', `RoomClient valid: ${!!this.roomClient}`, 'info');
            Logger.log('ConversationalAgent', `Room GUID: ${this.sceneId}`, 'info');
            
            // Check RoomClient peers
            const peerCount = this.roomClient.peers.size;
            const peerIds = Array.from(this.roomClient.peers.keys());
            Logger.log('ConversationalAgent', `RoomClient has ${peerCount} peers: [${peerIds.join(', ')}]`, 'info');
            
            Logger.log('ConversationalAgent', `Agent constructor completed for scene: ${sceneId}`, 'info');
            Logger.log('ConversationalAgent', '-------------------------------------------', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `ERROR in constructor: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Start the agent
     */
    start(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                if (this.isStarted) {
                    Logger.log('ConversationalAgent', 'Agent is already started', 'info');
                    resolve();
                    return;
                }

                Logger.log('ConversationalAgent', 'Starting agent...', 'info');

                // We already have the scene and roomClient from constructor
                Logger.log('ConversationalAgent', `Using existing scene and RoomClient`, 'info');
                
                // Log connection info for diagnostics
                Logger.log('ConversationalAgent', `RoomClient peer count: ${this.roomClient.peers.size}`, 'info');
                const peerUuids = Array.from(this.roomClient.peers.keys()).join(', ');
                Logger.log('ConversationalAgent', `Connected peers: [${peerUuids}]`, 'info');

                // Create components for the conversational agent
            this.registerComponents();
            
                // Set up the pipeline
            this.definePipeline();
                
                // Fix WebRTC connection
                setTimeout(() => {
                    this.fixWebRTCConnection();
                }, 3000);
                
                // Set up periodic tests
        setInterval(() => {
                    // Log connection status
                    const peers = Array.from(this.roomClient.peers.keys());
                    Logger.log('ConversationalAgent', `Connected to ${peers.length} peers`, 'info');
                    
                    // Run WebRTC check
                    this.fixWebRTCConnection();
                }, 60000); // Every minute
                
                // Set up initial audio test
                setTimeout(() => {
                    this.testAudioPipeline();
                }, 5000);

                this.isStarted = true;
                Logger.log('ConversationalAgent', 'Agent started successfully', 'info');
                resolve();
            } catch (error) {
                Logger.log('ConversationalAgent', `Error starting agent: ${error}`, 'error');
                reject(error);
            }
        });
    }

    /**
     * Handle messages from NetworkId 95
     */
    private handleNetworkId95Message(buffer: Buffer, senderId?: string): void {
        try {
            // Convert buffer to string and parse JSON
            const message = buffer.toString();
            
            // Skip if it's a binary message
            if (!message.startsWith('{')) {
                return;
            }
            
            const json = JSON.parse(message);
            
            // Handle debug commands
            if (json.type === 'DebugCommand') {
                Logger.log('ConversationalAgent', `Received debug command over network: ${json.command}`, 'info');
                this.handleDebugCommand(json.command);
                return;
            }
            
            // Handle audio control messages
            if (json.type === 'AudioControl') {
                if (json.action === 'fixRoom') {
                    this.fixRoomJoining();
                } else if (json.action === 'fixWebRTC') {
                    this.fixWebRTCConnection();
                }
            }
        } catch (error) {
            // Ignore parsing errors for non-JSON messages
            if (error instanceof SyntaxError) {
                return;
            }
            Logger.log('ConversationalAgent', `Error handling network message: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Send a test message to verify the text-to-speech pipeline is working
     */
    private sendTestMessage(): void {
        try {
            Logger.log('ConversationalAgent', 'Sending test message to verify agent is working', 'info');
            
            // Create a simple welcome message
            const testMessage = "Agent is now active and ready to assist.";
            
            // If TTS service is available, send the message
            if (this.components.textToSpeechService) {
                Logger.log('ConversationalAgent', `Sending test message to TTS: "${testMessage}"`, 'info');
                this.components.textToSpeechService.sendToChildProcess('default', testMessage);
            } else {
                Logger.log('ConversationalAgent', 'Cannot send test message - TTS service not available', 'warning');
            }
        } catch (error) {
            Logger.log('ConversationalAgent', `Error sending test message: ${error}`, 'error');
        }
    }

    registerComponents() {
        try {
            Logger.log('ConversationalAgent', `Registering components for scene: ${this.sceneId}`, 'info');
            
            // Ensure the RoomClient is properly connected first
            if (!this.roomClient) {
                Logger.log('ConversationalAgent', 'No RoomClient available! RTC will not work properly', 'error');
            return;
        }

            // Confirm room client is properly joined to a room
            const roomId = this.sceneId || (this.roomClient as any).room?.id || (this.roomClient as any).roomId;
            Logger.log('ConversationalAgent', `RoomClient is connected to room: ${roomId || 'unknown'}`, 'info');
            Logger.log('ConversationalAgent', `RoomClient has ${this.roomClient.peers?.size || 0} peers`, 'info');
            
            // Create each component with detailed logging
            Logger.log('ConversationalAgent', 'Creating MediaReceiver...', 'info');
            try {
                // Verify that the scene has network components before creating the MediaReceiver
                Logger.log('ConversationalAgent', `Scene verification: hasScene=${!!this.scene}, hasRoomClient=${!!this.roomClient}`, 'info');
                
                // Log detailed information about the scene
                if (this.scene) {
                    Logger.log('ConversationalAgent', `Scene properties: id=${(this.scene as any).id}, hasOnMethod=${typeof this.scene.on === 'function'}`, 'info');
                }
                
                // Create media receiver with both scene and roomClient references
                Logger.log('ConversationalAgent', 'Creating MediaReceiver with scene and roomClient', 'info');
                this.components.mediaReceiver = new MediaReceiver(this.scene, this.roomClient);
                
                // Start the media receiver explicitly
                if (this.components.mediaReceiver && typeof this.components.mediaReceiver.start === 'function') {
                    Logger.log('ConversationalAgent', 'Starting MediaReceiver explicitly', 'info');
                    this.components.mediaReceiver.start();
            }
        } catch (error) {
                Logger.log('ConversationalAgent', `ERROR creating MediaReceiver: ${error}`, 'error');
            }
            
            Logger.log('ConversationalAgent', 'Creating SpeechToTextService...', 'info');
            this.components.speech2text = new SpeechToTextService(this.scene, 'SpeechToTextService', this.sceneId);
            
            Logger.log('ConversationalAgent', 'Creating TextGenerationService...', 'info');
            this.components.textGenerationService = new TextGenerationService(this.scene, this.sceneId);
            
            Logger.log('ConversationalAgent', 'Creating TextToSpeechService...', 'info');
            this.components.textToSpeechService = new TextToSpeechService(this.scene);
            
            // Verify components are initialized
            Logger.log('ConversationalAgent', 'Component initialization status:', 'info');
            Logger.log('ConversationalAgent', `  - MediaReceiver: ${!!this.components.mediaReceiver}`, 'info');
            Logger.log('ConversationalAgent', `  - Speech2Text: ${!!this.components.speech2text}`, 'info');
            Logger.log('ConversationalAgent', `  - TextGeneration: ${!!this.components.textGenerationService}`, 'info');
            Logger.log('ConversationalAgent', `  - TextToSpeech: ${!!this.components.textToSpeechService}`, 'info');
            
            // Initialize the speech to text service with the room client
            if (this.components.speech2text) {
                Logger.log('ConversationalAgent', 'Setting room client on SpeechToTextService', 'info');
                this.components.speech2text.setRoomClient(this.roomClient);
            }
            
            Logger.log('ConversationalAgent', 'All components registered successfully', 'info');
            } catch (error) {
            Logger.log('ConversationalAgent', `ERROR registering components: ${error}`, 'error');
            throw error;
        }
    }

    definePipeline() {
        try {
            Logger.log('ConversationalAgent', `Setting up event pipeline for scene: ${this.sceneId}`, 'info');
            
            // Set up audio pipeline through dedicated method
            this.setupAudioPipeline();
            
            this.components.speech2text?.on('data', (data: Buffer, identifier: string) => {
                try {
                    const response = data.toString().trim();
                    const peer = this.roomClient.peers.get(identifier);
                    const peerName = peer?.properties?.get('ubiq.displayname') || 'Unknown';
                    Logger.log('ConversationalAgent', `Received STT data from ${peerName}: "${response}"`, 'info');
                    
                    let text = '';
                    
                    // Handle both JSON and plain text responses
                    if (response.startsWith('{')) {
                        try {
                            const jsonResponse = JSON.parse(response);
                            Logger.log('ConversationalAgent', `Parsed STT response:`, 'info');
                            text = jsonResponse.text;
            } catch (error) {
                            Logger.log('ConversationalAgent', `Error parsing JSON response: ${error}`, 'error');
                            return;
                        }
        } else {
                        // Handle plain text response
                        text = response;
                    }
                    
                    // Skip if no valid text or if it's a no-speech message
                    if (!text || text === '[No speech detected]') {
                        Logger.log('ConversationalAgent', 'No valid text in STT response, skipping text generation', 'info');
                        return;
                    }

                    // Log the text for debugging
                    Logger.log('ConversationalAgent', `Transcribed speech from ${peerName}: "${text}"`, 'info');

                    // Check for wake word - now much more lenient to catch more cases
                    const lowerText = text.toLowerCase();
                    
                    // Check for any wake word
                    const hasWakeWord = this.WAKE_WORDS.some(wakeWord => 
                        lowerText.includes(wakeWord)
                    );
                    
                    // Check for any genie variation
                    const hasGenie = this.GENIE_VARIATIONS.some(variation => 
                        lowerText.includes(variation)
                    );
                    
                    // Debug log for wake word detection
                    Logger.log('ConversationalAgent', `Wake word detection: hasWakeWord=${hasWakeWord}, hasGenie=${hasGenie}`, 'info');

                    // Make wake word optional but keep genie required
                    // if (!hasWakeWord || !hasGenie) {
                    if (!hasGenie) {
                        Logger.log('ConversationalAgent', 'No wake word detected, ignoring message', 'info');
                        return;
                    }

                    // Remove wake word and genie variation from the text
                    let cleanedText = text;
                    for (const wakeWord of this.WAKE_WORDS) {
                        const regex = new RegExp(`\\b${wakeWord}\\b\\s*[,]?\\s*`, 'i');
                        cleanedText = cleanedText.replace(regex, '');
                    }
                    for (const variation of this.GENIE_VARIATIONS) {
                        const regex = new RegExp(`\\s*[,]?\\s*\\b${variation}\\b`, 'i');
                        cleanedText = cleanedText.replace(regex, '');
                    }
                    cleanedText = cleanedText.trim();
                    
                    if (!cleanedText) {
                        Logger.log('ConversationalAgent', 'No message content after removing wake word', 'info');
                        return;
                    }
                    
                    const message = `${peerName} -> Agent:: ${cleanedText}`;
                    Logger.log('ConversationalAgent', `Sending to text generation: "${message}"`, 'info');
                    
                    if (this.components.textGenerationService) {
                        Logger.log('ConversationalAgent', 'Text generation service exists, sending data...', 'info');
                        this.components.textGenerationService.sendToChildProcess('default', Buffer.from(message));
                    } else {
                        Logger.log('ConversationalAgent', 'Text generation service does not exist!', 'error');
                    }
        } catch (error) {
                    Logger.log('ConversationalAgent', `Error processing STT response: ${error}`, 'error');
                }
            });

            this.components.textGenerationService?.on('data', (data: Buffer, identifier: string) => {
                try {
                    const response = data.toString().trim();
                    Logger.log('ConversationalAgent', `Received text generation: "${response}"`, 'info');
                    
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
                            Logger.log('ConversationalAgent', 'Skipping duplicate TTS request', 'info');
                            return;
                        }
                        
                        Logger.log('ConversationalAgent', `Sending to TTS: "${cleanedMessage}"`, 'info');
                        
                        // Only send to TTS if we have a valid message and TTS service
                        if (cleanedMessage && this.components.textToSpeechService) {
                            this.components.textToSpeechService.sendToChildProcess('default', cleanedMessage);
                            this.lastTTSMessage = cleanedMessage;
                            this.lastTTSTime = now;
                        } else {
                            Logger.log('ConversationalAgent', 'Skipping TTS - no valid message or TTS service not available', 'warning');
                        }
                    } else {
                        Logger.log('ConversationalAgent', `Invalid text generation response format: "${response}"`, 'warning');
                    }
                } catch (error) {
                    Logger.log('ConversationalAgent', `Error processing text generation response: ${error}`, 'error');
                }
            });

            this.components.textToSpeechService?.on('data', (data: Buffer, identifier: string) => {
                if (data.length > 0) {
                    Logger.log('ConversationalAgent', `Received TTS data of length: ${data.length} bytes`, 'info');
                    this.emit('tts-data', data);
                }
            });
                } catch (error) {
            Logger.log('ConversationalAgent', `ERROR setting up pipeline: ${error}`, 'error');
            throw error;
        }
    }

    /**
     * Attempts to diagnose and fix WebRTC connection issues that might prevent audio from flowing
     */
    private fixWebRTCConnection(): void {
        Logger.log('ConversationalAgent', 'Attempting to fix WebRTC connections', 'info');

        try {
            // 1. Ensure we have a valid room
            const room = this.roomClient?.room;
            if (!room) {
                Logger.log('ConversationalAgent', 'Cannot fix WebRTC: No room object', 'error');
                // Try to fix the room first then retry
                this.fixRoomJoining();
                return;
            }

            // 2. Get the room ID or use a fallback
            let roomId = (room as any)?.id;
            if (!roomId || roomId === '0' || roomId === 'null') {
                // Use UUID if available
                roomId = (room as any)?.uuid;
                
                // If still no valid ID, use the stored join code or a hardcoded known ID
                if (!roomId || roomId === '0' || roomId === 'null') {
                    roomId = this.roomJoinCode || '34db635d-94ea-45c3-afb6-b81fc5e6c33e';
                    
                    // Force set it on the room object
                    (room as any).id = roomId;
                    (room as any).uuid = roomId;
                    Logger.log('ConversationalAgent', `Set missing room ID to fallback: ${roomId}`, 'info');
                }
            }
            
            Logger.log('ConversationalAgent', `Using room ID for WebRTC: ${roomId}`, 'info');

            // 3. Ensure PeerConnectionManager is available
            const pcm = this.ensurePeerConnectionManager();
            Logger.log('ConversationalAgent', `PeerConnectionManager status: ${!!pcm}`, 'info');
            
            // 4. Get list of connected peers
            const peersArray = Array.from(this.roomClient?.getPeers() || []);
            const peerCount = peersArray.length;
            Logger.log('ConversationalAgent', `Connected peers: ${peerCount}`, 'info');
            
            if (peerCount === 0) {
                Logger.log('ConversationalAgent', 'No peers connected to establish WebRTC with', 'warning');
                return;
            }
            
            // 5. Reset and restart MediaReceiver if needed
            if (this.components.mediaReceiver) {
                try {
                    Logger.log('ConversationalAgent', 'Restarting MediaReceiver', 'info');
                    this.components.mediaReceiver.stop();
                    this.components.mediaReceiver.start();
                } catch (e) {
                    Logger.log('ConversationalAgent', `Error restarting MediaReceiver: ${(e as Error).message}`, 'error');
                }
            } else {
                this.setupAudioPipeline();
            }
            
            // 6. Attempt to connect with each peer
            for (const peer of peersArray) {
                try {
                    const peerId = peer.uuid;
                    if (!peerId) {
                        Logger.log('ConversationalAgent', 'Skipping peer with no UUID', 'warning');
                        continue;
                    }
                    
                    Logger.log('ConversationalAgent', `Initiating WebRTC connection with peer: ${peerId}`, 'info');
                    this.initiateWebRTCWithPeer(peerId);
                    
                    // Send a diagnostic ping to verify connection
                    try {
                        (this.roomClient as any)?.send({
                            type: 'diagnosticPing',
                            source: 'agent',
                            timestamp: Date.now()
                        }, peerId);
                        Logger.log('ConversationalAgent', `Sent diagnostic ping to peer: ${peerId}`, 'info');
                    } catch (pingError) {
                        Logger.log('ConversationalAgent', `Error sending diagnostic ping: ${(pingError as Error).message}`, 'error');
                        
                        // Try alternate ping method
                        try {
                            if (this.scene) {
                                this.scene.send(new NetworkId(95), JSON.stringify({
                                    type: 'Ping',
                                    targetPeer: peerId,
                                    uuid: 'agent',
                                    timestamp: Date.now()
                                }));
                                Logger.log('ConversationalAgent', `Sent alternate ping to peer: ${peerId}`, 'info');
                            }
                        } catch (altError) {
                            Logger.log('ConversationalAgent', `Error with alternate ping: ${(altError as Error).message}`, 'error');
                        }
                    }
                } catch (peerError) {
                    Logger.log('ConversationalAgent', `Error connecting to peer: ${(peerError as Error).message}`, 'error');
                }
            }
            
            // 7. Set up a diagnostics timer to monitor connection status
            setTimeout(() => {
                const pcmStatus = !!this.peerConnectionManager;
                const mrStatus = !!this.components.mediaReceiver;
                Logger.log('ConversationalAgent', `WebRTC connection status - PCM: ${pcmStatus}, MediaReceiver: ${mrStatus}`, 'info');
                
                if (this.components.mediaReceiver) {
                    const stats = (this.components.mediaReceiver as any).getStats?.() || {};
                    Logger.log('ConversationalAgent', `MediaReceiver stats: ${JSON.stringify(stats)}`, 'info');
                }
                
                // If no audio after this fix, try one more direct approach
                if (this.components.mediaReceiver) {
                    setTimeout(() => this.fixMediaReceiver(), 5000);
                }
            }, 5000);
        } catch (error) {
            Logger.log('ConversationalAgent', `Error fixing WebRTC connection: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Initiates a WebRTC connection with a specific peer
     */
    private initiateWebRTCWithPeer(peerId: string): void {
        if (!peerId) {
            Logger.log('ConversationalAgent', 'Cannot initiate WebRTC: No peer ID provided', 'error');
            return;
        }
        
        Logger.log('ConversationalAgent', `Initiating WebRTC connection with peer: ${peerId}`, 'info');
        
        // Ensure we have a PeerConnectionManager
        if (!this.peerConnectionManager) {
            const pcm = this.ensurePeerConnectionManager();
            if (!pcm) {
                Logger.log('ConversationalAgent', 'Cannot initiate WebRTC: Failed to create PeerConnectionManager', 'error');
                return;
            }
        }
        
        try {
            // Attempt to create a peer connection
            const result = this.peerConnectionManager.createPeerConnection(peerId);
            Logger.log('ConversationalAgent', `Created peer connection for ${peerId}, result: ${!!result}`, 'info');
            
            // If using MediaReceiver for connections, ensure it's properly set up
            if (this.components.mediaReceiver && !this.components.mediaReceiver.peerConnectionManager) {
                (this.components.mediaReceiver as any).peerConnectionManager = this.peerConnectionManager;
                Logger.log('ConversationalAgent', 'Associated PeerConnectionManager with MediaReceiver', 'info');
            }
        } catch (error) {
            Logger.log('ConversationalAgent', `Error creating peer connection: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Sets up the audio pipeline for receiving and processing audio
     */
    private setupAudioPipeline(): void {
        Logger.log('ConversationalAgent', 'Setting up audio pipeline', 'info');
        
        // First ensure we have a valid room
        if (!this.roomClient?.room) {
            Logger.log('ConversationalAgent', 'Room not initialized, fixing room joining first', 'warning');
            this.fixRoomJoining();
        }
        
        // Ensure PeerConnectionManager exists before setting up MediaReceiver
        const pcm = this.ensurePeerConnectionManager();
        Logger.log('ConversationalAgent', `PeerConnectionManager status: ${!!pcm}`, 'info');
        
        try {
            // If we already have a MediaReceiver, stop it first
            if (this.components.mediaReceiver) {
                Logger.log('ConversationalAgent', 'Stopping existing MediaReceiver', 'info');
                try {
                    this.components.mediaReceiver.stop();
                } catch (e) {
                    Logger.log('ConversationalAgent', `Error stopping MediaReceiver: ${(e as Error).message}`, 'warning');
                }
            }
            
            // Try different MediaReceiver initialization approaches
            const approaches = [
                // First approach: try with both Scene and RoomClient
                () => {
                    Logger.log('ConversationalAgent', 'Creating MediaReceiver with Scene and RoomClient', 'info');
                    return new MediaReceiver(this.scene, this.roomClient);
                },
                // Second approach: with RoomClient only
                () => {
                    Logger.log('ConversationalAgent', 'Creating MediaReceiver with RoomClient only', 'info');
                    return new MediaReceiver(this.roomClient);
                },
                // Third approach: with Scene only
                () => {
                    Logger.log('ConversationalAgent', 'Creating MediaReceiver with Scene only', 'info');
                    return new MediaReceiver(this.scene);
                },
                // Fourth approach: explicit constructor call with null checks
                () => {
                    Logger.log('ConversationalAgent', 'Creating MediaReceiver with explicit null checks', 'info');
                    if (this.scene && this.roomClient) {
                        return new MediaReceiver(this.scene, this.roomClient);
                    } else if (this.scene) {
                        return new MediaReceiver(this.scene);
                    } else if (this.roomClient) {
                        return new MediaReceiver(this.roomClient);
                    }
                    throw new Error('Both scene and roomClient are unavailable');
                }
            ];
            
            // Try each approach until one succeeds
            let mediaReceiver = null;
            let error = null;
            
            for (const approach of approaches) {
                try {
                    mediaReceiver = approach();
                    if (mediaReceiver) {
                        break;
                    }
                } catch (e) {
                    error = e;
                    // Continue to next approach
                }
            }
            
            if (!mediaReceiver) {
                Logger.log('ConversationalAgent', `All MediaReceiver initialization attempts failed: ${(error as Error)?.message || 'unknown error'}`, 'error');
                return;
            }
            
            // Store the successful MediaReceiver
            this.components.mediaReceiver = mediaReceiver;
            Logger.log('ConversationalAgent', 'MediaReceiver created successfully', 'info');
            
            // Associate PCM with MediaReceiver if available
            if (this.peerConnectionManager && this.components.mediaReceiver) {
                Logger.log('ConversationalAgent', 'Associating PeerConnectionManager with MediaReceiver', 'info');
                (this.components.mediaReceiver as any).peerConnectionManager = this.peerConnectionManager;
            }
            
            // Start the MediaReceiver
            if (this.components.mediaReceiver) {
                this.components.mediaReceiver.start();
                Logger.log('ConversationalAgent', 'MediaReceiver started', 'info');
            }
            
            // Add listeners for audio data for diagnostics
            if (this.components.mediaReceiver) {
                try {
                    if (typeof this.components.mediaReceiver.addListener === 'function') {
                        this.components.mediaReceiver.addListener('audiodata', () => {
                            if (!this.lastAudioDataTime || Date.now() - this.lastAudioDataTime > 5000) {
                                this.lastAudioDataTime = Date.now();
                                Logger.log('ConversationalAgent', 'Audio data received from MediaReceiver', 'info');
                            }
                        });
                        
                        // Also try alternate event names that might be used
                        ['audio', 'data', 'audio-data', 'stream-data'].forEach(eventName => {
                            try {
                                this.components.mediaReceiver?.addListener(eventName, () => {
                                    Logger.log('ConversationalAgent', `Received data on alternate event: ${eventName}`, 'info');
                                });
                            } catch (e) {
                                // Ignore errors for alternate event names
                            }
                        });
                    }
                } catch (listenerError) {
                    Logger.log('ConversationalAgent', `Error adding listeners: ${(listenerError as Error).message}`, 'warning');
                }
            }
            
            // Log media receiver status for diagnostics
            Logger.log('ConversationalAgent', `MediaReceiver status: ${JSON.stringify({
                hasReceiver: !!this.components.mediaReceiver,
                hasPCM: !!(this.components.mediaReceiver as any).peerConnectionManager,
                events: ['audiodata', 'audio', 'data']
            })}`, 'info');
            
            // Schedule a connection with all peers
            setTimeout(() => this.connectWithAllPeers(), 2000);
        } catch (error) {
            Logger.log('ConversationalAgent', `Error setting up audio pipeline: ${(error as Error).message}`, 'error');
        }
    }
    
    /**
     * Broadcast audio to all connected peers without requiring a specific target
     * This can work even when room connections are problematic
     * @param frequency The frequency of the tone in Hz
     * @param volume The volume of the tone (0.0 to 1.0)
     */
    private broadcastAudio(frequency: number = 440, volume: number = 0.7): void {
        try {
            Logger.log('ConversationalAgent', `Broadcasting audio tone (${frequency}Hz) to all peers...`, 'info');
            
            // Generate a simple sine wave tone
            const sampleRate = 48000;
            const duration = 1.5; // seconds
            const numSamples = Math.floor(sampleRate * duration);
            const samples = new Int16Array(numSamples);
            
            // Generate sine wave
            for (let i = 0; i < numSamples; i++) {
                samples[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767 * volume; // Adjust volume
            }
            
            // Convert to Buffer
            const audioData = Buffer.from(samples.buffer);
            
            // Broadcast an AudioInfo message without targetPeer field
            this.scene.send(new NetworkId(95), JSON.stringify({
                type: 'AudioInfo',
                // No targetPeer field - this means broadcast to all clients
                audioLength: audioData.length,
                uuid: this.roomClient?.peer?.uuid || 'genie-agent',
                timestamp: Date.now(),
                sampleRate: sampleRate,
                channels: 1,
                bitsPerSample: 16,
                format: 'PCM-Chunked'
            }));
            
            // Send audio data in chunks
            const chunkSize = 8000; // Larger chunks for efficiency
            let offset = 0;
            let chunkNum = 0;
            const totalChunks = Math.ceil(audioData.length / chunkSize);
            
            while (offset < audioData.length) {
                const chunk = audioData.slice(offset, Math.min(offset + chunkSize, audioData.length));
                this.scene.send(new NetworkId(95), chunk);
                offset += chunkSize;
                chunkNum++;
                
                if (chunkNum % 10 === 0 || chunkNum === totalChunks) {
                    Logger.log('ConversationalAgent', `Sent broadcast audio chunk ${chunkNum}/${totalChunks}`, 'info');
                }
            }
            
            Logger.log('ConversationalAgent', `Audio broadcast complete (${totalChunks} chunks)`, 'info');
        } catch (error: any) {
            Logger.log('ConversationalAgent', `Error broadcasting audio: ${error.message}`, 'error');
        }
    }
    
    /**
     * Ensure the agent is properly connected to a room
     */
    private fixRoomJoining(): void {
      try {
        Logger.log('ConversationalAgent', 'Checking room connection status', 'info');

        // Check if the RoomClient exists
        if (!this.roomClient) {
          Logger.log('ConversationalAgent', 'RoomClient not initialized', 'error');
          return;
        }

        // Check if we have a valid room ID
        const room = this.roomClient.room;
        const roomId = (room as any)?.id;
        Logger.log('ConversationalAgent', `Current room ID: ${roomId || 'null'}`, 'info');

        // IMPORTANT: These are known room IDs from logs - use these as fallbacks
        const knownRoomIds = [
          '34db635d-94ea-45c3-afb6-b81fc5e6c33e', // Most commonly seen room ID
          '31ec68d8-c752-4756-b8fe-a543a8968e6c',
          '4a2e6d35-7cef-419d-8884-264e3f2348f2',
          'genie-room-' + Date.now() // Fallback with timestamp
        ];

        if (!roomId || roomId === '0' || roomId === 'null') {
          // Try to join a specific room from our known list
          let targetRoomId = knownRoomIds[0]; // Use the first known room ID
          Logger.log('ConversationalAgent', `Attempting to join known room: ${targetRoomId}`, 'info');

          try {
            // First try the join method if it exists
            if (typeof (this.roomClient as any).join === 'function') {
              (this.roomClient as any).join(targetRoomId);
              Logger.log('ConversationalAgent', `Joined room using join method: ${targetRoomId}`, 'info');
            }
            // If that fails, try rejoinRoom
            else if (typeof (this.roomClient as any).rejoinRoom === 'function') {
              (this.roomClient as any).rejoinRoom(targetRoomId);
              Logger.log('ConversationalAgent', `Rejoined room: ${targetRoomId}`, 'info');
            }
            // If that fails, try joinRoom
            else if (typeof (this.roomClient as any).joinRoom === 'function') {
              (this.roomClient as any).joinRoom(targetRoomId);
              Logger.log('ConversationalAgent', `Joined room using direct method: ${targetRoomId}`, 'info');
            }
            // Last resort - manually set the room ID
            else if (this.roomClient.room) {
              // Force the room ID directly
              (this.roomClient.room as any).id = targetRoomId;
              (this.roomClient.room as any).uuid = targetRoomId;
              Logger.log('ConversationalAgent', `Manually set room ID to: ${targetRoomId}`, 'info');
            }
          } catch (error) {
            Logger.log('ConversationalAgent', `Error joining room via API: ${(error as Error).message}`, 'error');
            
            // Direct property manipulation as last resort
            try {
              // First create a room object if it doesn't exist
              if (!this.roomClient.room && typeof (this.roomClient as any).createRoom === 'function') {
                (this.roomClient as any).createRoom();
              }
              
              // Force-set the room properties
              if (this.roomClient.room) {
                (this.roomClient.room as any).id = targetRoomId;
                (this.roomClient.room as any).uuid = targetRoomId;
                this.roomJoinCode = targetRoomId;
                Logger.log('ConversationalAgent', `Force-set room ID to: ${targetRoomId}`, 'info');
              }
            } catch (fallbackError) {
              Logger.log('ConversationalAgent', `Fallback room ID setting failed: ${(fallbackError as Error).message}`, 'error');
            }
          }

          // Wait to check if we have a valid room now
          setTimeout(() => {
            const updatedRoom = this.roomClient?.room;
            const updatedRoomId = (updatedRoom as any)?.id || (updatedRoom as any)?.uuid;
            Logger.log('ConversationalAgent', `Updated room ID after joining attempt: ${updatedRoomId || 'null'}`, 'info');
            
            if (updatedRoomId && updatedRoomId !== '0' && updatedRoomId !== 'null') {
              // Room joining succeeded, now try to fix WebRTC
              this.fixWebRTCConnection();
            } else {
              // Final fallback - directly set the roomClient's room ID
              if (this.roomClient.room) {
                (this.roomClient.room as any).id = targetRoomId;
                (this.roomClient.room as any).uuid = targetRoomId;
                Logger.log('ConversationalAgent', `Final fallback: Set room ID to ${targetRoomId}`, 'info');
                
                // Try WebRTC again
                setTimeout(() => this.fixWebRTCConnection(), 1000);
              }
            }
          }, 2000);
        } else {
          Logger.log('ConversationalAgent', `Already connected to valid room: ${roomId}`, 'info');
        }
      } catch (error) {
        Logger.log('ConversationalAgent', `Error fixing room joining: ${(error as Error).message}`, 'error');
      }
    }

    /**
     * Dump room status information
     */
    private dumpRoomStatus(): void {
        try {
            Logger.log('ConversationalAgent', '========== ROOM STATUS ==========', 'info');
            
            // Check room client
            if (!this.roomClient) {
                Logger.log('ConversationalAgent', 'RoomClient is null', 'error');
            return;
        }
        
            // Check room object
            const room = this.roomClient.room as any;
            if (!room) {
                Logger.log('ConversationalAgent', 'Room object is null', 'error');
                return;
            }
            
            // Log detailed room information
            Logger.log('ConversationalAgent', 'Room details:', 'info');
            Logger.log('ConversationalAgent', `  - ID: ${room.id || 'null'}`, 'info');
            Logger.log('ConversationalAgent', `  - UUID: ${room.uuid || 'null'}`, 'info');
            Logger.log('ConversationalAgent', `  - Join Code: ${room.joincode || 'null'}`, 'info');
            Logger.log('ConversationalAgent', `  - Name: ${room.name || 'null'}`, 'info');
            Logger.log('ConversationalAgent', `  - Publish: ${room.publish || false}`, 'info');
            
            // Log peer info
            Logger.log('ConversationalAgent', `Our peer UUID: ${this.roomClient.peer?.uuid || 'unknown'}`, 'info');
            
            // Log properties
            if (room.properties && typeof room.properties.entries === 'function') {
                Logger.log('ConversationalAgent', 'Room properties:', 'info');
                for (const [key, value] of room.properties.entries()) {
                    Logger.log('ConversationalAgent', `  - ${key}: ${value}`, 'info');
                }
            }
            
            // Log peer count
            const peerCount = this.roomClient.peers?.size || 0;
            Logger.log('ConversationalAgent', `Connected peers: ${peerCount}`, 'info');
            
            // Log network status
            const isNetworkConnected = (this.roomClient as any).connectionId ? true : false;
            Logger.log('ConversationalAgent', `Network connected: ${isNetworkConnected}`, 'info');
            Logger.log('ConversationalAgent', `Connection ID: ${(this.roomClient as any).connectionId || 'null'}`, 'info');
            
            Logger.log('ConversationalAgent', '============================', 'info');
        } catch (error: any) {
            Logger.log('ConversationalAgent', `Error dumping room status: ${error.message}`, 'error');
        }
    }

    /**
     * Dump information about all connected peers
     */
    private dumpPeers(): void {
        try {
            Logger.log('ConversationalAgent', '========== CONNECTED PEERS ==========', 'info');
            
            if (!this.roomClient || !this.roomClient.peers) {
                Logger.log('ConversationalAgent', 'RoomClient or peers collection is null', 'error');
                return;
            }

            const peerCount = this.roomClient.peers.size;
            Logger.log('ConversationalAgent', `Found ${peerCount} peers`, 'info');
            
            if (peerCount === 0) {
                Logger.log('ConversationalAgent', 'No peers connected', 'warning');
                return;
            }
            
            // Log each peer's details
            let peerNum = 1;
            for (const [peerId, peerObj] of this.roomClient.peers.entries()) {
                Logger.log('ConversationalAgent', `Peer ${peerNum}: ${peerId}`, 'info');
                
                try {
                    // Try to get display name
                    const displayName = (peerObj as any)?.properties?.get('ubiq.displayname') || 'Unknown';
                    Logger.log('ConversationalAgent', `  - Display Name: ${displayName}`, 'info');
                    
                    // Try to get room ID from peer
                    const roomId = (peerObj as any)?.properties?.get('ubiq.room') || 'Unknown';
                    Logger.log('ConversationalAgent', `  - Room ID: ${roomId}`, 'info');
                    
                    // Log additional properties if available
                    if ((peerObj as any)?.properties && typeof (peerObj as any).properties.entries === 'function') {
                        for (const [key, value] of (peerObj as any).properties.entries()) {
                            if (key !== 'ubiq.displayname' && key !== 'ubiq.room') {
                                Logger.log('ConversationalAgent', `  - ${key}: ${value}`, 'info');
                            }
                        }
                    }
                } catch (peerError: any) {
                    Logger.log('ConversationalAgent', `  - Error getting peer details: ${peerError.message}`, 'error');
                }
                
                peerNum++;
            }
            
            Logger.log('ConversationalAgent', '================================', 'info');
        } catch (error: any) {
            Logger.log('ConversationalAgent', `Error dumping peers: ${error.message}`, 'error');
        }
    }

    /**
     * Test the audio pipeline with various audio formats
     * This helps diagnose which format Unity can actually receive
     */
    private testAudioPipeline(): void {
        try {
            Logger.log('ConversationalAgent', '========== TESTING AUDIO PIPELINE ==========', 'info');
            
            // Get all possible peers for direct targeting
            const peers = Array.from(this.roomClient?.getPeers() || []);
            
            if (!peers.length) {
                Logger.log('ConversationalAgent', 'No peers found for audio tests', 'warning');
                return;
            }
            
            // Try each peer
            peers.forEach(peer => {
                const peerId = peer.uuid;
                if (!peerId) {
                    Logger.log('ConversationalAgent', 'Skipping peer with no UUID', 'warning');
                    return;
                }
                
                Logger.log('ConversationalAgent', `Testing audio with peer: ${peerId}`, 'info');
                
                // APPROACH 1: Send audio using standard method
                Logger.log('ConversationalAgent', 'TESTING APPROACH 1: Direct audio tone', 'info');
                this.sendDirectAudioTone(peerId, 440, 1.0);
                
                // APPROACH 2: Raw PCM data
                setTimeout(() => {
                    Logger.log('ConversationalAgent', 'TESTING APPROACH 2: Raw PCM audio', 'info');
                    this.sendRawPCMAudio(peerId);
                }, 3000);
                
                // APPROACH 3: Base64 encoded audio
                setTimeout(() => {
                    Logger.log('ConversationalAgent', 'TESTING APPROACH 3: Base64 encoded audio', 'info');
                    this.sendBase64Audio(peerId);
                }, 6000);
            });
            
            Logger.log('ConversationalAgent', '========== AUDIO TEST COMPLETE ==========', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `Error testing audio pipeline: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Send a simple audio tone directly to a peer
     * @param peerId The peer ID to send to
     * @param frequency The frequency of the tone in Hz
     * @param volume The volume of the tone (0.0 to 1.0)
     */
    private sendDirectAudioTone(peerId: string, frequency: number = 440, volume: number = 0.5): void {
        try {
            Logger.log('ConversationalAgent', `Sending audio tone (${frequency}Hz) to peer: ${peerId}`, 'info');
            
            // Generate a simple sine wave tone
            const sampleRate = 48000;
            const duration = 1.0; // seconds
            const numSamples = Math.floor(sampleRate * duration);
            const samples = new Int16Array(numSamples);
            
            // Generate sine wave
            for (let i = 0; i < numSamples; i++) {
                samples[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767 * volume; // Adjust volume
            }
            
            // Convert to Buffer
            const audioData = Buffer.from(samples.buffer);
            
            // Send the audio data to the peer
            this.sendAudioData(peerId, audioData, sampleRate);
            
            Logger.log('ConversationalAgent', `Audio tone sent successfully to peer: ${peerId}`, 'info');
            } catch (error) {
            Logger.log('ConversationalAgent', `Error sending audio tone: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Send raw PCM audio data to a peer
     * @param peerId The peer ID to send to
     */
    private sendRawPCMAudio(peerId: string): void {
        try {
            Logger.log('ConversationalAgent', `Sending raw PCM audio to peer: ${peerId}`, 'info');
            
            // Generate a simple sine wave tone with frequency sweep
            const sampleRate = 48000;
            const duration = 2.0; // seconds
            const numSamples = Math.floor(sampleRate * duration);
            const samples = new Int16Array(numSamples);
            
            // Generate frequency sweep (from 220Hz to 880Hz)
            const startFreq = 220;
            const endFreq = 880;
            
            for (let i = 0; i < numSamples; i++) {
                const t = i / numSamples; // Time position (0 to 1)
                const frequency = startFreq + t * (endFreq - startFreq); // Linear frequency sweep
                const phase = 2 * Math.PI * frequency * i / sampleRate;
                samples[i] = Math.sin(phase) * 32767 * 0.7; // 70% volume
            }
            
            // Convert to Buffer
            const audioData = Buffer.from(samples.buffer);
            
            // Send the audio data through the roomClient
            this.sendAudioData(peerId, audioData, sampleRate, 'PCM-Raw');
            
            Logger.log('ConversationalAgent', `Raw PCM audio sent successfully to peer: ${peerId}`, 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `Error sending raw PCM audio: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Send Base64 encoded audio to a peer
     * @param peerId The peer ID to send to
     */
    private sendBase64Audio(peerId: string): void {
        try {
            Logger.log('ConversationalAgent', `Sending Base64 encoded audio to peer: ${peerId}`, 'info');
            
            // Generate a simple sine wave tone with amplitude modulation
            const sampleRate = 48000;
            const duration = 1.5; // seconds
            const numSamples = Math.floor(sampleRate * duration);
            const samples = new Int16Array(numSamples);
            
            // Generate tone with amplitude modulation
            const carrierFreq = 440; // Hz
            const modFreq = 2; // Hz - slow modulation
            
            for (let i = 0; i < numSamples; i++) {
                const t = i / sampleRate; // Time in seconds
                const modulation = 0.5 + 0.5 * Math.sin(2 * Math.PI * modFreq * t); // 0 to 1 modulation
                samples[i] = Math.sin(2 * Math.PI * carrierFreq * t) * 32767 * modulation;
            }
            
            // Convert to Buffer and then to Base64
            const audioData = Buffer.from(samples.buffer);
            const base64Data = audioData.toString('base64');
            
            // Send through the roomClient with type assertion
            (this.roomClient as any)?.send({
                type: 'AudioData',
                format: 'Base64',
                sampleRate: sampleRate,
                channels: 1,
                bitsPerSample: 16,
                data: base64Data,
                timestamp: Date.now()
            }, peerId);
            
            Logger.log('ConversationalAgent', `Base64 encoded audio sent successfully to peer: ${peerId}`, 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `Error sending Base64 encoded audio: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Helper method to send audio data to a peer
     */
    private sendAudioData(peerId: string, audioData: Buffer, sampleRate: number, format: string = 'PCM-Chunked'): void {
        try {
            // Send through the roomClient - using type assertion
            (this.roomClient as any)?.send({
                type: 'AudioInfo',
                format: format,
                sampleRate: sampleRate,
                channels: 1,
                bitsPerSample: 16,
                length: audioData.length,
                timestamp: Date.now()
            }, peerId);
            
            // Send data in chunks
            const chunkSize = 4000;
            for (let offset = 0; offset < audioData.length; offset += chunkSize) {
                const chunk = audioData.slice(offset, Math.min(offset + chunkSize, audioData.length));
                (this.roomClient as any)?.send(chunk, peerId);
            }
        } catch (error) {
            Logger.log('ConversationalAgent', `Error in sendAudioData: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Logs the MediaReceiver status for diagnostics
     */
    private logMediaReceiverStatus(): void {
        if (!this.components.mediaReceiver) {
            Logger.log('ConversationalAgent', 'MediaReceiver is null, cannot log status', 'error');
            return;
        }
        
        try {
            const mediaReceiver = this.components.mediaReceiver as any;
            
            // Log basic information
            Logger.log('ConversationalAgent', '========== MEDIA RECEIVER STATUS ==========', 'info');
            
            // Check if audioContext exists
            const hasAudioContext = mediaReceiver.audioContext !== undefined;
            Logger.log('ConversationalAgent', `Has AudioContext: ${hasAudioContext}`, 'info');
            
            // Check if peerConnectionManager exists
            const hasPCM = mediaReceiver.peerConnectionManager !== undefined;
            Logger.log('ConversationalAgent', `Has PeerConnectionManager: ${hasPCM}`, 'info');
            
            // Check if there are event listeners
            const hasEventListeners = typeof mediaReceiver.on === 'function' || 
                                    typeof mediaReceiver.addListener === 'function';
            Logger.log('ConversationalAgent', `Has event listeners: ${hasEventListeners}`, 'info');
            
            // If we have a PCM, check its properties
            if (hasPCM && mediaReceiver.peerConnectionManager) {
                const pcm = mediaReceiver.peerConnectionManager;
                const pcmKeys = Object.keys(pcm);
                Logger.log('ConversationalAgent', `PeerConnectionManager properties: ${pcmKeys.join(', ')}`, 'info');
                
                // Check for essential methods
                const hasCreatePeerConnection = typeof pcm.createPeerConnection === 'function';
                Logger.log('ConversationalAgent', `PCM has createPeerConnection: ${hasCreatePeerConnection}`, 'info');
            }
            
            // Check statistics
            if (typeof mediaReceiver.getStats === 'function') {
                try {
                    const stats = mediaReceiver.getStats();
                    Logger.log('ConversationalAgent', `MediaReceiver stats: ${JSON.stringify(stats)}`, 'info');
                } catch (e) {
                    Logger.log('ConversationalAgent', `Error getting MediaReceiver stats: ${(e as Error).message}`, 'error');
                }
            }
            
            Logger.log('ConversationalAgent', '==========================================', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `Error logging MediaReceiver status: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Ensure PeerConnectionManager is available
     */
    private ensurePeerConnectionManager(): any {
        if (!this.peerConnectionManager) {
            Logger.log('ConversationalAgent', 'PeerConnectionManager not initialized', 'warning');
            return null;
        }
        return this.peerConnectionManager;
    }

    /**
     * Handles debug commands received from clients
     */
    private handleDebugCommand(command: string): void {
        try {
            Logger.log('ConversationalAgent', `Received debug command: ${command}`, 'info');
            
            switch (command) {
                case 'help':
                    // Send help text back to the client
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'help',
                        data: [
                            'Available debug commands:',
                            'help - Show this help text',
                            'status - Show agent status',
                            'mediaStatus - Show media receiver status',
                            'fixWebRTC - Attempt to fix WebRTC connections',
                            'initPCM - Initialize the PeerConnectionManager',
                            'broadcastAudio - Send test audio to all clients',
                            'fixMedia - Fix MediaReceiver issues'
                        ].join('\n')
                    });
                    break;
                    
                case 'status':
                    // Show agent status
                    const peersArray = Array.from(this.roomClient?.getPeers() || []);
                    
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'status',
                        data: {
                            agentId: this.sceneId,
                            roomConnected: !!this.roomClient,
                            peersCount: peersArray.length,
                            mediaReceiver: !!this.components.mediaReceiver,
                            peerConnectionManager: !!this.peerConnectionManager
                        }
                    });
                    break;
                    
                case 'fixWebRTC':
                    // Attempt to fix WebRTC connections
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'fixWebRTC',
                        data: 'Attempting to fix WebRTC connections...'
                    });
                    
                    // Call the fix method with a delay
            setTimeout(() => {
                        try {
                            if (typeof this.fixWebRTCConnection === 'function') {
                                this.fixWebRTCConnection();
                            } else {
                                Logger.log('ConversationalAgent', 'fixWebRTCConnection method not available', 'error');
                            }
                        } catch (e) {
                            Logger.log('ConversationalAgent', `Error in fixWebRTCConnection: ${(e as Error).message}`, 'error');
                        }
                    }, 500);
                    break;
                    
                case 'initPCM':
                    // Initialize the PeerConnectionManager
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'initPCM',
                        data: 'Initializing PeerConnectionManager...'
                    });
                    
                    // Try to create or find PCM
                    try {
                        // If we have a method, use it, otherwise create directly
                        if (typeof this.peerConnectionManager === 'undefined') {
                            if (PeerConnectionManager) {
                                this.peerConnectionManager = new PeerConnectionManager(this.scene);
                                Logger.log('ConversationalAgent', 'Created new PeerConnectionManager', 'info');
                                
                                // Check if it has expected methods
                                const hasMethods = typeof this.peerConnectionManager.createPeerConnection === 'function';
                                Logger.log('ConversationalAgent', `PCM has createPeerConnection method: ${hasMethods}`, 'info');
                                
                                // Try to register with the scene
                                if (this.scene && typeof this.scene.register === 'function') {
                                    this.scene.register(this.peerConnectionManager);
                                    Logger.log('ConversationalAgent', 'Registered PCM with scene', 'info');
                                }
                                
                                // Send success response
                                this.broadcastMessage({
                                    type: 'DebugCommandResponse',
                                    command: 'initPCM',
                                    data: 'PeerConnectionManager initialized successfully'
                                });
                            } else {
                                Logger.log('ConversationalAgent', 'PeerConnectionManager class not available', 'error');
                                
                                this.broadcastMessage({
                                    type: 'DebugCommandResponse',
                                    command: 'initPCM',
                                    data: 'Error: PeerConnectionManager class not available'
                                });
                            }
                        } else {
                            Logger.log('ConversationalAgent', 'PeerConnectionManager already exists', 'info');
                            
                            this.broadcastMessage({
                                type: 'DebugCommandResponse',
                                command: 'initPCM',
                                data: 'PeerConnectionManager already exists'
                            });
                        }
                    } catch (e) {
                        Logger.log('ConversationalAgent', `Error initializing PCM: ${(e as Error).message}`, 'error');
                        
                        this.broadcastMessage({
                            type: 'DebugCommandResponse',
                            command: 'initPCM',
                            data: `Error: ${(e as Error).message}`
                        });
                    }
                    break;
                    
                case 'mediaStatus':
                    // Check MediaReceiver status
                    let statusMessage = '';
                    
                    if (!this.components.mediaReceiver) {
                        statusMessage = 'MediaReceiver not initialized';
                    } else {
                        try {
                            const mediaReceiver = this.components.mediaReceiver;
                            const pcm = (mediaReceiver as any).peerConnectionManager;
                            
                            statusMessage = JSON.stringify({
                                initialized: true,
                                hasPCM: !!pcm,
                                pcmProperties: pcm ? Object.keys(pcm) : [],
                                mediaReceiverRunning: true
                            }, null, 2);
                        } catch (e) {
                            statusMessage = `Error getting status: ${(e as Error).message}`;
                        }
                    }
                    
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'mediaStatus',
                        data: statusMessage
                    });
                    break;
                    
                case 'fixMedia':
                    // Fix MediaReceiver issues
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'fixMedia',
                        data: 'Attempting to fix MediaReceiver issues...'
                    });
                    
                    // Call the fix method
                    this.fixMediaReceiver();
                    break;
                    
                case 'broadcastAudio':
                    // Broadcast audio to all peers
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: 'broadcastAudio',
                        data: 'Broadcasting audio to all peers...'
                    });
                    
                    // Send test audio to all peers
                    this.sendTestAudioToAllPeers();
                    break;
                    
                default:
                    Logger.log('ConversationalAgent', `Unknown debug command: ${command}`, 'warning');
                    
                    this.broadcastMessage({
                        type: 'DebugCommandResponse',
                        command: command,
                        data: `Unknown command: ${command}`
                    });
                    break;
            }
        } catch (e) {
            Logger.log('ConversationalAgent', `Error handling debug command: ${(e as Error).message}`, 'error');
        }
    }

    /**
     * Broadcasts a message to all connected peers
     */
    private broadcastMessage(message: any): void {
        try {
            if (!this.roomClient) {
                Logger.log('ConversationalAgent', 'Cannot broadcast message: RoomClient not available', 'error');
                return;
            }
            
            // Convert iterator to array and check its size
            const peersArray = Array.from(this.roomClient.getPeers());
            
            if (peersArray.length === 0) {
                Logger.log('ConversationalAgent', 'No peers to broadcast to', 'warning');
                return;
            }
            
            // Send to each peer
            for (const peer of peersArray) {
                if (peer && peer.uuid) {
                    (this.roomClient as any).send(message, peer.uuid);
                }
            }
            
            Logger.log('ConversationalAgent', `Broadcast message sent to ${peersArray.length} peers`, 'info');
        } catch (e) {
            Logger.log('ConversationalAgent', `Error broadcasting message: ${(e as Error).message}`, 'error');
        }
    }

    /**
     * Initialize the agent, setting up networking and listeners
     */
    initialize(): void {
        try {
            Logger.log('ConversationalAgent', 'Initializing agent...', 'info');

            // Set up listeners for NetworkId 95
            this.scene.on('message', (networkId: any, buffer: Buffer, senderId?: string) => {
                if (networkId.id === 95) {
                    this.handleNetworkId95Message(buffer, senderId);
                }
            });
            
            // Start the initialization sequence with proper delays between steps
            this.startInitializationSequence();
            
            Logger.log('ConversationalAgent', 'Agent initialization sequence started', 'info');
        } catch (error) {
            Logger.log('ConversationalAgent', `Error initializing agent: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Run the initialization sequence with proper timing
     */
    private startInitializationSequence(): void {
        try {
            // Step 1: Fix room joining issues first (this is the most critical step)
            Logger.log('ConversationalAgent', 'STEP 1: Fixing room connection', 'info');
            this.fixRoomJoining();
            
            // Step 2: Initialize the audio pipeline after room joining
            setTimeout(() => {
                Logger.log('ConversationalAgent', 'STEP 2: Setting up audio pipeline', 'info');
                this.setupAudioPipeline();
                
                // Step 3: Fix WebRTC connection issues
                setTimeout(() => {
                    Logger.log('ConversationalAgent', 'STEP 3: Fixing WebRTC connections', 'info');
                    this.fixWebRTCConnection();
                    
                    // Step 4: Fix MediaReceiver issues as a final step
                    setTimeout(() => {
                        Logger.log('ConversationalAgent', 'STEP 4: Fixing MediaReceiver', 'info');
                        this.fixMediaReceiver();
                        
                        // Step 5: Set up periodic checks
                        this.setupPeriodicChecks();
                        
                        Logger.log('ConversationalAgent', 'Initialization sequence completed', 'info');
                    }, 5000);
                }, 3000);
            }, 2000);
        } catch (error) {
            Logger.log('ConversationalAgent', `Error in initialization sequence: ${(error as Error).message}`, 'error');
        }
    }

    /**
     * Set up periodic check timers
     */
    private setupPeriodicChecks(): void {
        // Set up a periodic diagnostic check
        setInterval(() => {
            this.logMediaReceiverStatus();
        }, 30000);
        
        // Set up periodic room connection check
        setInterval(() => {
            const room = this.roomClient?.room;
            const roomId = (room as any)?.id;
            
            if (!roomId || roomId === '0' || roomId === 'null') {
                Logger.log('ConversationalAgent', 'Periodic check: Room ID is invalid, fixing...', 'warning');
                this.fixRoomJoining();
            }
        }, 60000);
        
        // Set up periodic audio flow check
        setInterval(() => {
            if (this.components.mediaReceiver) {
                const stats = (this.components.mediaReceiver as any).getStats?.() || {};
                const audioFlowing = stats.audioSamples || stats.frames || stats.packets;
                
                if (!audioFlowing) {
                    Logger.log('ConversationalAgent', 'Periodic check: No audio flowing, fixing MediaReceiver', 'warning');
                    this.fixMediaReceiver();
                }
            }
        }, 90000);
    }

    /**
     * Fix issues with MediaReceiver not receiving audio
     */
    private fixMediaReceiver(): void {
      try {
        Logger.log('ConversationalAgent', '========== FIXING MEDIA RECEIVER ==========', 'info');
        
        // Check if MediaReceiver exists
        if (!this.components.mediaReceiver) {
          Logger.log('ConversationalAgent', 'MediaReceiver not initialized, creating new instance', 'info');
          this.setupAudioPipeline();
          return;
        }
        
        // Stop and restart MediaReceiver
        Logger.log('ConversationalAgent', 'Restarting MediaReceiver', 'info');
        this.components.mediaReceiver.stop();
        
        // Short delay before restarting
        setTimeout(() => {
          try {
            // Start MediaReceiver
            this.components.mediaReceiver?.start();
            Logger.log('ConversationalAgent', 'MediaReceiver restarted', 'info');
            
            // Ensure PeerConnectionManager is associated with MediaReceiver
            if (this.peerConnectionManager) {
              (this.components.mediaReceiver as any).peerConnectionManager = this.peerConnectionManager;
              Logger.log('ConversationalAgent', 'PeerConnectionManager reassociated with MediaReceiver', 'info');
            }
            
            // Connect with all peers
            this.connectWithAllPeers();
            
            // Send test audio after a short delay
            setTimeout(() => {
              this.sendTestAudioToAllPeers();
            }, 5000);
          } catch (restartError) {
            Logger.log('ConversationalAgent', `Error restarting MediaReceiver: ${(restartError as Error).message}`, 'error');
          }
        }, 1000);
        
        Logger.log('ConversationalAgent', '========== MEDIA RECEIVER FIX INITIATED ==========', 'info');
      } catch (error) {
        Logger.log('ConversationalAgent', `Error fixing MediaReceiver: ${(error as Error).message}`, 'error');
      }
    }

    /**
     * Connect with all peers in the room
     */
    private connectWithAllPeers(): void {
      try {
        // Get all peers
        const peersArray = Array.from(this.roomClient?.getPeers() || []);
        Logger.log('ConversationalAgent', `Connecting with ${peersArray.length} peers`, 'info');
        
        // Connect with each peer
        for (const peer of peersArray) {
          const peerId = peer.uuid;
          if (!peerId) continue;
          
          // Create peer connection
          this.initiateWebRTCWithPeer(peerId);
          
          // Send a ping to ensure connection
          (this.roomClient as any)?.send({
            type: 'ConnectionCheck',
            source: 'agent',
            timestamp: Date.now()
          }, peerId);
        }
      } catch (error) {
        Logger.log('ConversationalAgent', `Error connecting with peers: ${(error as Error).message}`, 'error');
      }
    }

    /**
     * Send test audio to all peers
     */
    private sendTestAudioToAllPeers(): void {
      try {
        // Get all peers
        const peersArray = Array.from(this.roomClient?.getPeers() || []);
        Logger.log('ConversationalAgent', `Sending test audio to ${peersArray.length} peers`, 'info');
        
        // Send audio to each peer
        for (const peer of peersArray) {
          const peerId = peer.uuid;
          if (!peerId) continue;
          
          // Send a test tone
          this.sendDirectAudioTone(peerId, 440, 0.8);
          
          // Log the action
          Logger.log('ConversationalAgent', `Sent test audio to peer: ${peerId}`, 'info');
        }
      } catch (error) {
        Logger.log('ConversationalAgent', `Error sending test audio: ${(error as Error).message}`, 'error');
      }
    }
} 