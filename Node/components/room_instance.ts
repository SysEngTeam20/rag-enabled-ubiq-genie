import { NetworkScene } from 'ubiq';
import { RoomClient } from 'ubiq-server/components/roomclient.js';
import { ConversationalAgent } from '../apps/conversational_agent/agent.js';
import { Logger } from './logger.js';

export class RoomInstance {
    private agent: ConversationalAgent | null = null;
    private scene: NetworkScene;
    private roomClient: RoomClient;
    private roomId: string;
    
    constructor(scene: NetworkScene, roomClient: RoomClient, roomId: string) {
        Logger.log('RoomInstance', '-------------------------------------------', 'info');
        Logger.log('RoomInstance', `Creating room instance with ID: ${roomId}`, 'info');
        
        this.scene = scene;
        this.roomClient = roomClient;
        this.roomId = roomId;
        
        Logger.log('RoomInstance', `Scene valid: ${!!this.scene}`, 'info');
        Logger.log('RoomInstance', `RoomClient valid: ${!!this.roomClient}`, 'info');
        
        // Check RoomClient peers
        const peerCount = this.roomClient.peers?.size || 0;
        const peerIds = Array.from(this.roomClient.peers?.keys() || []);
        Logger.log('RoomInstance', `RoomClient has ${peerCount} peers: [${peerIds.join(', ')}]`, 'info');
        
        // Initialize agent immediately
        this.initAgent();
        Logger.log('RoomInstance', '-------------------------------------------', 'info');
    }
    
    initAgent(): void {
        try {
            Logger.log('RoomInstance', `Initializing agent for room: ${this.roomId}`, 'info');
            
            if (this.agent) {
                Logger.log('RoomInstance', 'Agent already exists, skipping initialization', 'info');
                return;
            }
            
            Logger.log('RoomInstance', 'Creating new ConversationalAgent...', 'info');
            this.agent = new ConversationalAgent(this.scene, this.roomClient, this.roomId);
            
            // Listen for agent started event
            this.agent.on('started', (sceneId: string) => {
                Logger.log('RoomInstance', `Received agent started event for scene: ${sceneId}`, 'info');
            });
            
            // Start the agent immediately
            Logger.log('RoomInstance', 'Starting agent...', 'info');
            this.agent.start();
            
            Logger.log('RoomInstance', 'Agent initialization completed successfully', 'info');
        } catch (error) {
            Logger.log('RoomInstance', `ERROR initializing agent: ${error}`, 'error');
            // Don't rethrow to prevent breaking the application
            this.agent = null;
        }
    }
    
    removeAgent(): void {
        try {
            Logger.log('RoomInstance', `Removing agent for room: ${this.roomId}`, 'info');
            
            if (!this.agent) {
                Logger.log('RoomInstance', 'No agent exists, nothing to remove', 'info');
                return;
            }
            
            // TODO: Add cleanup logic for agent
            this.agent = null;
            Logger.log('RoomInstance', 'Agent removed successfully', 'info');
        } catch (error) {
            Logger.log('RoomInstance', `ERROR removing agent: ${error}`, 'error');
            // Reset agent reference even on error
            this.agent = null;
        }
    }
    
    getRoomId(): string {
        return this.roomId;
    }
    
    getAgent(): ConversationalAgent | null {
        return this.agent;
    }
    
    hasAgent(): boolean {
        return this.agent !== null;
    }
} 