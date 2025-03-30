import { NetworkId, NetworkScene } from 'ubiq';
import { RoomClient } from 'ubiq-server/components/roomclient.js';
import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { ConversationalAgent } from '../apps/conversational_agent/agent.js';
import { validate as validateUuid } from 'uuid';
import { RoomInstance } from './room_instance.js';

// Define a peer interface based on how Ubiq uses it
interface UbiqPeer {
    id: string;
    networkId: NetworkId;
    me?: boolean;
    joined?: boolean;
    Name?: string;
}

/**
 * Class to manage multiple room instances and their associated services
 */
export class RoomManager extends EventEmitter {
    private rooms: Map<string, RoomInstance> = new Map<string, RoomInstance>();
    private scene: NetworkScene;
    private roomClient: RoomClient | null = null;
    private pollInterval: NodeJS.Timeout | null = null;
    private readonly POLL_INTERVAL_MS = 5000; // Check every 5 seconds
    
    constructor(scene: NetworkScene) {
        super();
        this.scene = scene;
        Logger.log('RoomManager', 'Room Manager initialized with scene', 'info');
    }

    /**
     * Validate if a string is a valid GUID
     */
    private isValidGuid(str: any): boolean {
        if (typeof str !== 'string') {
            return false;
        }
        
        // GUID format: 8-4-4-4-12 hex digits
        const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return guidRegex.test(str);
    }
    
    /**
     * Poll for room status in case we missed events
     */
    private pollRoomStatus(): void {
        try {
            if (!this.roomClient) {
                return;
            }
            
            const roomId = this.getRoomId();
            
            Logger.log('RoomManager', `Polling room status, current room ID: ${roomId}`, 'info');
            
            if (roomId && this.isValidGuid(roomId)) {
                // Always create a room instance for valid room IDs, regardless of peer count
                if (!this.rooms.has(roomId)) {
                    Logger.log('RoomManager', `Polling detected valid room that needs instance: ${roomId}`, 'info');
                    
                    // Get peer details for logging
                    const peerCount = this.roomClient.peers.size;
                    const peerIds = Array.from(this.roomClient.peers.keys());
                    Logger.log('RoomManager', `Room has ${peerCount} peers: [${peerIds.join(', ')}]`, 'info');
                    
                    // Detail each peer for debugging
                    peerIds.forEach(peerId => {
                        const peer = this.roomClient?.peers.get(peerId);
                        if (peer) {
                            const peerName = peer.properties?.get('ubiq.displayname') || 'Unknown';
                            const peerIsMe = !!(peer as any).me;
                            Logger.log('RoomManager', `Peer detail - ID: ${peerId}, Name: ${peerName}, Me: ${peerIsMe}`, 'info');
                        }
                    });
                    
                    // Create the room instance
                    if (this.roomClient) {
                        const roomInstance = new RoomInstance(this.scene, this.roomClient, roomId);
                        this.rooms.set(roomId, roomInstance);
                        Logger.log('RoomManager', `Room instance created by polling`, 'info');
                    }
                }
            } else {
                Logger.log('RoomManager', `Polling: Room ID is invalid or empty: ${roomId}`, 'info');
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR in polling room status: ${error}`, 'error');
        }
    }
    
    /**
     * Get the current room ID from Ubiq
     */
    private getRoomId(): string | null {
        if (!this.roomClient) {
            return null;
        }
        
        try {
            // Get the room ID - it could be in different places depending on the Ubiq version
            let roomId: any = null;
            
            // Try different properties where the room ID might be stored
            if ((this.roomClient as any).room) {
                if (typeof (this.roomClient as any).room === 'string') {
                    roomId = (this.roomClient as any).room;
                } else if (typeof (this.roomClient as any).room === 'object') {
                    // If room is an object, try to extract its id or guid property
                    const room = (this.roomClient as any).room;
                    
                    // Log the object for debugging
                    Logger.log('RoomManager', `Room object structure: ${JSON.stringify(room)}`, 'info');
                    
                    if (room.id && typeof room.id === 'string') {
                        roomId = room.id;
                    } else if (room.guid && typeof room.guid === 'string') {
                        roomId = room.guid;
                    } else if (room.roomId && typeof room.roomId === 'string') {
                        roomId = room.roomId;
                    } else if (room.toString) {
                        // Try to convert to string if it has a toString method
                        const roomStr = room.toString();
                        if (this.isValidGuid(roomStr)) {
                            roomId = roomStr;
                        }
                    }
                }
            }
            
            // Try other possible properties
            if (!roomId && (this.roomClient as any).roomId && typeof (this.roomClient as any).roomId === 'string') {
                roomId = (this.roomClient as any).roomId;
            }
            
            if (!roomId && (this.roomClient as any).guid && typeof (this.roomClient as any).guid === 'function') {
                const guidFn = (this.roomClient as any).guid;
                const guidResult = guidFn.call(this.roomClient);
                if (typeof guidResult === 'string') {
                    roomId = guidResult;
                }
            }
            
            // Try to get the room ID from the actual room creation logs
            if (!roomId) {
                // If we have peers in the room, check if any are in a specific room
                if (this.roomClient.peers && this.roomClient.peers.size > 0) {
                    for (const peer of this.roomClient.peers.values()) {
                        if ((peer as any).roomId && typeof (peer as any).roomId === 'string') {
                            roomId = (peer as any).roomId;
                            break;
                        }
                    }
                }
            }
            
            // Ensure it's a valid string GUID
            if (roomId && typeof roomId === 'string' && this.isValidGuid(roomId)) {
                Logger.log('RoomManager', `Successfully found valid room ID: ${roomId}`, 'info');
                return roomId;
            } else {
                if (roomId) {
                    Logger.log('RoomManager', `Invalid room ID detected: ${roomId}, type: ${typeof roomId}`, 'warning');
                }
                return null;
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR getting room ID: ${error}`, 'error');
            return null;
        }
    }

    /**
     * Set up listeners for room events from the Ubiq room server
     */
    private setupRoomEventListeners(): void {
        if (!this.roomClient) {
            return;
        }
        
        // Try multiple event name patterns to ensure we catch the right ones
        const possibleEventNames = [
            'OnJoinedRoom', 'onJoinedRoom', 'joinedRoom', 'JoinedRoom',
            'roomJoined', 'RoomJoined', 'OnRoomJoined', 'onRoomJoined'
        ];
        
        possibleEventNames.forEach(eventName => {
            this.roomClient?.on(eventName, (...args: any[]) => {
                Logger.log('RoomManager', `Event ${eventName} triggered with ${args.length} arguments`, 'info');
                this.handleRoomJoined();
            });
        });
        
        // Register for all possible peer events
        const peerAddedEvents = [
            'OnPeerAdded', 'onPeerAdded', 'PeerAdded', 'peerAdded',
            'peerJoined', 'PeerJoined', 'OnPeerJoined', 'onPeerJoined'
        ];
        
        peerAddedEvents.forEach(eventName => {
            this.roomClient?.on(eventName, (peer: any) => {
                Logger.log('RoomManager', `Event ${eventName} triggered for peer: ${peer?.id || 'unknown'}`, 'info');
                this.handlePeerAdded(peer);
            });
        });
        
        // Try to hook directly into the roomclient's message system
        this.scene.on('message', (networkId: any, message: any) => {
            // Look for room-related messages (generally these have networkId between 1-10)
            if (typeof networkId === 'object' && networkId.id < 10) {
                Logger.log('RoomManager', `Received network message with ID: ${networkId.id}`, 'info');
                
                // Check for room messages specifically
                if (message && typeof message === 'object' && message.type === 'joined-room') {
                    const roomId = message.roomId || message.room;
                    Logger.log('RoomManager', `Detected room join via network message: ${roomId}`, 'info');
                    this.handleRoomJoined();
                }
            }
        });
    }
    
    /**
     * Handle room joined event
     */
    private handleRoomJoined(): void {
        try {
            const roomId = this.getRoomId();
            Logger.log('RoomManager', `Room joined event received for room ID: ${roomId}`, 'info');
            
            // Validate room ID
            if (roomId && this.isValidGuid(roomId)) {
                Logger.log('RoomManager', `Room ID is valid, creating room instance`, 'info');
                this.checkAndCreateRoomInstance();
            } else {
                Logger.log('RoomManager', `Ignoring invalid room ID: ${roomId}`, 'warning');
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR handling room joined event: ${error}`, 'error');
        }
    }
    
    /**
     * Handle peer added event
     */
    private handlePeerAdded(peer: UbiqPeer): void {
        try {
            const roomId = this.getRoomId();
            Logger.log('RoomManager', `Peer added event received: ${JSON.stringify(peer)} in room: ${roomId}`, 'info');
            
            // Check if room ID is valid and peer is not me
            if (roomId && this.isValidGuid(roomId) && !peer.me) {
                Logger.log('RoomManager', `External peer added to valid room, checking room instance`, 'info');
                this.checkAndCreateRoomInstance();
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR handling peer added event: ${error}`, 'error');
        }
    }

    /**
     * Get or create a room with the specified scene ID
     * @param sceneId The unique identifier for the scene/room
     * @returns The room instance
     */
    public getOrCreateRoom(sceneId: string): RoomInstance {
        if (this.rooms.has(sceneId)) {
            Logger.log('RoomManager', `Returning existing room for scene: ${sceneId}`, 'info');
            return this.rooms.get(sceneId)!;
        }

        Logger.log('RoomManager', `Creating new room for scene: ${sceneId}`, 'info');
        
        if (!this.roomClient) {
            throw new Error("Cannot create room: roomClient is null");
        }
        
        // Try to force the room client to join this specific room
        Logger.log('RoomManager', `Attempting to ensure room client is joined to room: ${sceneId}`, 'info');
        
        // 1. Check current room
        const currentRoomId = this.getRoomId();
        Logger.log('RoomManager', `Current room ID from roomClient: ${currentRoomId || 'none'}`, 'info');
        
        // 2. If not already in this room, try to join it
        if (currentRoomId !== sceneId) {
            try {
                Logger.log('RoomManager', `Current room (${currentRoomId}) differs from requested (${sceneId}), joining...`, 'info');
                this.roomClient.join(sceneId);
                
                // Wait a bit and then check if we successfully joined
                setTimeout(() => {
                    const newRoomId = this.getRoomId();
                    Logger.log('RoomManager', `After join, room ID is: ${newRoomId || 'none'}`, 'info');
                    
                    // If we still don't have the right room ID, try to force it
                    if (newRoomId !== sceneId) {
                        Logger.log('RoomManager', `Join may have failed, attempting to force room ID...`, 'info');
                        this.forceRoomId(sceneId);
                    }
                }, 1000);
            } catch (error) {
                Logger.log('RoomManager', `Error joining room: ${error}`, 'error');
                
                // Try to force the room ID anyway
                this.forceRoomId(sceneId);
            }
        }
        
        const roomInstance = new RoomInstance(this.scene, this.roomClient, sceneId);
        this.rooms.set(sceneId, roomInstance);
        return roomInstance;
    }
    
    /**
     * Force a specific room ID on the room client
     * This is a last resort if normal joining fails
     */
    private forceRoomId(roomId: string): void {
        Logger.log('RoomManager', `Forcing room ID: ${roomId}`, 'info');
        
        try {
            if (!this.roomClient) return;
            
            // Try to find the room property
            if ((this.roomClient as any).room) {
                const room = (this.roomClient as any).room;
                
                // Force UUID if it's an object
                if (typeof room === 'object') {
                    if ('uuid' in room) {
                        Logger.log('RoomManager', `Setting room.uuid = ${roomId}`, 'info');
                        room.uuid = roomId;
                    }
                    if ('id' in room) {
                        Logger.log('RoomManager', `Setting room.id = ${roomId}`, 'info');
                        room.id = roomId;
                    }
                    if ('roomId' in room) {
                        Logger.log('RoomManager', `Setting room.roomId = ${roomId}`, 'info');
                        room.roomId = roomId;
                    }
                }
            }
            
            // Try direct property
            if ('roomId' in this.roomClient) {
                Logger.log('RoomManager', `Setting roomClient.roomId = ${roomId}`, 'info');
                (this.roomClient as any).roomId = roomId;
            }
            
            // Verify if it worked
            setTimeout(() => {
                const currentRoomId = this.getRoomId();
                Logger.log('RoomManager', `After forcing, room ID is: ${currentRoomId || 'none'}`, 'info');
            }, 500);
        } catch (error) {
            Logger.log('RoomManager', `Error forcing room ID: ${error}`, 'error');
        }
    }

    /**
     * Cleanup a room when it's no longer needed
     * @param sceneId The unique identifier for the scene/room
     */
    private cleanupRoom(sceneId: string): void {
        const room = this.rooms.get(sceneId);
        if (!room) return;
        
        Logger.log('RoomManager', `Cleaning up room for scene: ${sceneId}`, 'info');
        room.removeAgent();
        this.rooms.delete(sceneId);
        this.emit('room-destroyed', sceneId);
    }

    /**
     * Get all active rooms
     * @returns Map of active rooms by sceneId
     */
    public getActiveRooms(): Map<string, RoomInstance> {
        return this.rooms;
    }

    /**
     * Check if a room exists
     * @param sceneId The unique identifier for the scene/room
     * @returns True if the room exists
     */
    public hasRoom(sceneId: string): boolean {
        return this.rooms.has(sceneId);
    }

    /**
     * Set the room client for the manager
     * @param roomClient the room client to set
     */
    public setRoomClient(roomClient: RoomClient): void {
        this.roomClient = roomClient;
        Logger.log('RoomManager', 'RoomClient set on RoomManager', 'info');
        
        // Examine the room client to understand its state
        if (roomClient) {
            // Check for existing room ID
            const roomId = this.getRoomId();
            Logger.log('RoomManager', `RoomClient current room ID: ${roomId || 'not joined'}`, 'info');
            
            // Check for peers
            const peerCount = roomClient.peers?.size || 0;
            Logger.log('RoomManager', `RoomClient has ${peerCount} peers`, 'info');
            
            // Register for room events
            Logger.log('RoomManager', 'Setting up room event handlers', 'info');
            this.setupRoomEventListeners();
            
            // Start polling for room status
            this.startRoomPolling();
            
            // If already in a room, create instance immediately
            if (roomId && this.isValidGuid(roomId)) {
                Logger.log('RoomManager', `RoomClient already in room ${roomId}, creating room instance`, 'info');
                this.getOrCreateRoom(roomId);
            }
        }
    }
    
    /**
     * Start polling for room status
     */
    private startRoomPolling(): void {
        // Clear any existing poll
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        // Start new polling interval
        this.pollInterval = setInterval(() => this.pollRoomStatus(), this.POLL_INTERVAL_MS);
        Logger.log('RoomManager', `Started room polling (every ${this.POLL_INTERVAL_MS}ms)`, 'info');
    }

    private checkAndCreateRoomInstance(): void {
        try {
            // Get current room ID
            const roomId = this.getRoomId();
            
            // Check if room ID is valid
            if (roomId && this.isValidGuid(roomId)) {
                Logger.log('RoomManager', `Found valid room ID: ${roomId}, checking peers...`, 'info');
                
                // Only create a room instance if it doesn't already exist
                if (!this.rooms.has(roomId)) {
                    Logger.log('RoomManager', `Creating new room instance for ID: ${roomId}`, 'info');
                    
                    if (this.roomClient) {
                        const roomInstance = new RoomInstance(this.scene, this.roomClient, roomId);
                        this.rooms.set(roomId, roomInstance);
                        Logger.log('RoomManager', `Room instance created successfully`, 'info');
                        
                        // Force agent initialization
                        Logger.log('RoomManager', 'Forcing agent initialization', 'info');
                        roomInstance.initAgent();
                    } else {
                        Logger.log('RoomManager', 'Cannot create room instance: room client is null', 'warning');
                    }
                } else {
                    Logger.log('RoomManager', `Room instance already exists for ID: ${roomId}`, 'info');
                }
            } else {
                Logger.log('RoomManager', `Room ID is invalid or empty: ${roomId}`, 'info');
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR checking and creating room instance: ${error}`, 'error');
        }
    }

    private setupRoomEventHandlers(): void {
        if (!this.roomClient) {
            Logger.log('RoomManager', 'Cannot set up event handlers: room client is null', 'warning');
            return;
        }

        try {
            Logger.log('RoomManager', 'Setting up room event handlers', 'info');
            
            // Set up event handlers using our custom methods to detect room events
            this.listenForRoomEvents();
            
            // Set up direct method overrides
            this.setupMethodOverrides();
            
            Logger.log('RoomManager', 'Room event handlers set up successfully', 'info');
        } catch (error) {
            Logger.log('RoomManager', `ERROR setting up room event handlers: ${error}`, 'error');
        }
    }
    
    private listenForRoomEvents(): void {
        if (!this.roomClient) {
            return;
        }
        
        // Try to access any events the roomClient might expose
        const possibleEventNames = [
            'roomjoined', 'roomJoined', 'joinedRoom', 'joined',
            'room-joined', 'room_joined', 'roomchange', 'roomChange'
        ];
        
        // Listen for room join events
        possibleEventNames.forEach(eventName => {
            this.roomClient?.on(eventName, (...args: any[]) => {
                Logger.log('RoomManager', `Event ${eventName} triggered with ${args.length} arguments`, 'info');
                this.handleRoomJoined();
            });
        });
        
        // Listen for peer events
        const peerAddedEvents = [
            'peeradded', 'peerAdded', 'peer-added', 'peer_added',
            'peerconnected', 'peerConnected', 'peer-connected', 'peer_connected'
        ];
        
        peerAddedEvents.forEach(eventName => {
            this.roomClient?.on(eventName, (peer: any) => {
                Logger.log('RoomManager', `Event ${eventName} triggered for peer: ${peer?.id || 'unknown'}`, 'info');
                this.handlePeerAdded(peer);
            });
        });
    }
    
    private setupMethodOverrides(): void {
        if (!this.roomClient) {
            return;
        }
        
        // Try to hook directly into the roomclient's methods
        const originalJoin = this.roomClient.join;
        if (typeof this.roomClient.join === 'function') {
            const _this = this; // Store reference to this for closure
            this.roomClient.join = function(roomId: string) {
                Logger.log('RoomManager', `Join method called for room: ${roomId}`, 'info');
                
                // Call the original method
                if (originalJoin) {
                    const result = originalJoin.call(_this.roomClient, roomId);
                    
                    // Then handle the room joined event
                    setTimeout(() => {
                        _this.handleRoomJoined();
                    }, 500); // Give it time to process
                    
                    return result;
                }
                return undefined;
            };
        }
    }

    private handlePeerUpdated(peer: UbiqPeer): void {
        try {
            const roomId = this.getRoomId();
            Logger.log('RoomManager', `Peer updated event received: ${JSON.stringify(peer)} in room: ${roomId}`, 'info');
            
            // Check if room ID is valid and peer is not me
            if (roomId && this.isValidGuid(roomId) && !peer.me && peer.joined) {
                Logger.log('RoomManager', `External peer joined a valid room, checking room instance`, 'info');
                this.checkAndCreateRoomInstance();
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR handling peer updated event: ${error}`, 'error');
        }
    }

    addRoom(roomId: string): void {
        try {
            Logger.log('RoomManager', `Adding room with ID: ${roomId}`, 'info');
            
            if (!this.isValidGuid(roomId)) {
                Logger.log('RoomManager', `Cannot add room: Invalid room ID: ${roomId}`, 'warning');
                return;
            }
            
            if (this.rooms.has(roomId)) {
                Logger.log('RoomManager', `Room already exists with ID: ${roomId}`, 'info');
                return;
            }
            
            if (!this.roomClient) {
                Logger.log('RoomManager', 'Cannot add room: room client is null', 'warning');
                return;
            }
            
            const roomInstance = new RoomInstance(this.scene, this.roomClient, roomId);
            this.rooms.set(roomId, roomInstance);
            Logger.log('RoomManager', `Room added successfully: ${roomId}`, 'info');
        } catch (error) {
            Logger.log('RoomManager', `ERROR adding room: ${error}`, 'error');
        }
    }

    removeRoom(roomId: string): void {
        try {
            Logger.log('RoomManager', `Removing room with ID: ${roomId}`, 'info');
            
            const roomInstance = this.rooms.get(roomId);
            if (roomInstance) {
                roomInstance.removeAgent();
                this.rooms.delete(roomId);
                Logger.log('RoomManager', `Room removed successfully: ${roomId}`, 'info');
            } else {
                Logger.log('RoomManager', `Room not found with ID: ${roomId}`, 'warning');
            }
        } catch (error) {
            Logger.log('RoomManager', `ERROR removing room: ${error}`, 'error');
        }
    }

    getRoom(roomId: string): RoomInstance | undefined {
        return this.rooms.get(roomId);
    }

    getRooms(): Map<string, RoomInstance> {
        return this.rooms;
    }
}