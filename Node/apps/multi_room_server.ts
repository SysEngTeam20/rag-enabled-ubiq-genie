import { ApplicationController } from '../components/application.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../components/logger.js';

/**
 * Multi-Room Server for Ubiq Genie
 * 
 * This server creates a Ubiq server that can dynamically create and manage
 * multiple rooms, each with its own scene-specific conversational agent.
 * Rooms are created on-demand when clients request to join, and are destroyed
 * when all clients leave.
 */
export async function startServer() {
    try {
        Logger.log('MultiRoomServer', 'Starting multi-room server...', 'info');
        
        // Get the path to the config file
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const configPath = path.resolve(__dirname, 'server_config.json');
        
        // Create the application controller with config path
        const app = new ApplicationController();
        
        // Initialize server mode without joining a specific room
        await app.initializeServer();
        
        Logger.log('MultiRoomServer', 'Server started and ready for connections', 'info');
        
        return app;
    } catch (error) {
        Logger.log('MultiRoomServer', `Failed to start server: ${error}`, 'error');
        throw error;
    }
}

// Create a simple idle function to keep the process alive
function keepAlive(): NodeJS.Timeout {
    // This interval will keep the Node.js event loop active
    const interval = setInterval(() => {
        // Adding a simple log to show the server is still running
        Logger.log('MultiRoomServer', 'Server is running...', 'info');
    }, 60000); // Log every minute
    
    // Return the interval so it can be cleared if needed
    return interval;
}

/**
 * Main function to start the server when this file is run directly
 */
async function main() {
    let keepAliveInterval: NodeJS.Timeout | undefined;
    
    try {
        const app = await startServer();
        
        // Keep the process running
        keepAliveInterval = keepAlive();
        Logger.log('MultiRoomServer', 'Server is running in the background', 'info');
        
        // Handle shutdown
        process.on('SIGINT', () => {
            Logger.log('MultiRoomServer', 'Shutting down server...', 'info');
            if (keepAliveInterval) clearInterval(keepAliveInterval);
            process.exit(0);
        });
    } catch (error) {
        Logger.log('MultiRoomServer', `Failed to start server: ${error}`, 'error');
        process.exit(1);
    }
}

// Start the server if this file is run directly
// Use a more reliable way to detect if file is run directly
if (process.argv[1] && process.argv[1].includes('multi_room_server')) {
    main().catch(err => {
        Logger.log('MultiRoomServer', `Uncaught error: ${err}`, 'error');
        process.exit(1);
    });
}