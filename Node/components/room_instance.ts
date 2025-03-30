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
            
            // First verify that the room client is properly joined to a room
            const clientRoomId = (this.roomClient as any).room?.id || 
                               (this.roomClient as any).room?.uuid ||
                               (this.roomClient as any).roomId ||
                               (typeof (this.roomClient as any).guid === 'function' ? (this.roomClient as any).guid() : null);
            
            Logger.log('RoomInstance', `RoomClient room ID: ${clientRoomId || 'unknown'}, Expected room ID: ${this.roomId}`, 'info');
            
            // Verify peers
            const peerCount = this.roomClient.peers?.size || 0;
            Logger.log('RoomInstance', `RoomClient has ${peerCount} peers before creating agent`, 'info');
            
            // Force join the room if needed
            if (!clientRoomId || clientRoomId !== this.roomId) {
                Logger.log('RoomInstance', `WARNING: RoomClient is not properly joined to room ${this.roomId}, attempting to fix`, 'warning');
                
                try {
                    // Force join
                    Logger.log('RoomInstance', `Forcing RoomClient to join ${this.roomId}`, 'info');
                    this.roomClient.join(this.roomId);
                    
                    // Try to force the room ID directly
                    if ((this.roomClient as any).room) {
                        if (typeof (this.roomClient as any).room === 'object') {
                            // Set all possible room ID properties
                            if ((this.roomClient as any).room.uuid !== undefined) {
                                (this.roomClient as any).room.uuid = this.roomId;
                            }
                            if ((this.roomClient as any).room.id !== undefined) {
                                (this.roomClient as any).room.id = this.roomId;
                            }
                        }
                    }
                    
                    // Set direct roomId if it exists
                    if ((this.roomClient as any).roomId !== undefined) {
                        (this.roomClient as any).roomId = this.roomId;
                    }
                    
                    // Log the current state again
                    const newClientRoomId = (this.roomClient as any).room?.id || 
                                          (this.roomClient as any).room?.uuid ||
                                          (this.roomClient as any).roomId ||
                                          (typeof (this.roomClient as any).guid === 'function' ? (this.roomClient as any).guid() : null);
                    Logger.log('RoomInstance', `After fixing, RoomClient room ID: ${newClientRoomId || 'unknown'}`, 'info');
                } catch (error) {
                    Logger.log('RoomInstance', `Error fixing room ID: ${error}`, 'error');
                }
            }
            
            Logger.log('RoomInstance', 'Creating new ConversationalAgent...', 'info');
            this.agent = new ConversationalAgent(this.scene, this.roomClient, this.roomId);
            
            // Check if the agent was properly created and has all expected components
            if (this.agent) {
                Logger.log('RoomInstance', 'Agent created successfully, checking components...', 'info');
                
                // Verify MediaReceiver is initialized by accessing it 
                const mediaReceiver = (this.agent as any).components?.mediaReceiver;
                Logger.log('RoomInstance', `MediaReceiver initialized: ${!!mediaReceiver}`, 'info');
                
                if (mediaReceiver) {
                    // Force start the MediaReceiver to ensure it's fully operational
                    if (typeof mediaReceiver.start === 'function') {
                        Logger.log('RoomInstance', 'Explicitly starting MediaReceiver...', 'info');
                        mediaReceiver.start();
                    } else {
                        Logger.log('RoomInstance', 'MediaReceiver does not have a start method', 'warning');
                    }
                } else {
                    Logger.log('RoomInstance', 'MediaReceiver was not initialized in agent', 'error');
                }
            }
            
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