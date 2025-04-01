# Ubiq-Genie Node.js Server

This is the `multi-room-support` branch of Ubiq-Genie, which enables concurrent activities with multiple rooms (1 room = 1 scene). While this branch offers better scalability for multiple concurrent activities, it currently has a minor bug with audio WebRTC transmission between the Unity client and the Genie agent.

## System Architecture

The system consists of three main components:

- **Unity Client**: The VR interface where users interact with the AI agent. The Unity scene contains components that communicate with the server through WebRTC connections using Ubiq's `Networking` components.

- **Node.js Server**: The server-side application that manages:
  - Speech-to-Text (STT) service for converting user speech to text
  - Text-to-Speech (TTS) service for generating agent responses
  - WebSocket communication for real-time audio streaming
  - Multi-room coordination and user management
  - Room-specific agent instances

- **Python Services**: External services that handle:
  - Speech recognition (using Whisper)
  - Text-to-speech synthesis
  - Audio processing and streaming

## Environment Setup

1. Create and activate a Python virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Install Node.js dependencies:
```bash
npm install
```

4. Configure environment variables:
   - Copy `.env.template` to `.env.local`
   - Update the variables with your configuration:
     - `API_BASE_URL`: Base URL for API endpoints
     - `API_SECRET_KEY`: JWT signing secret
     - `LLM_SERVER`: Local LLM server address
     - `LLM_PORT`: Local LLM server port
     - `ACTIVITY_ID`: Activity identifier for the room
     - `WEBSOCKET_SERVER_URL`: WebSocket server for STT/TTS
     - `APP_PORT`: Main application server port

## Running the Application

1. Start the Node.js server:
```bash
npm start conversational_agent
```

2. Launch the Unity client and connect to the room specified in your configuration.

## Multi-Room Architecture

Each room in the system:
- Has its own dedicated agent instance
- Maintains separate RAG context
- Supports multiple concurrent users
- Operates independently of other rooms

### Room Management
- Dynamic room creation and destruction based on client demand
- Each room has its own scene-specific conversational agent
- Rooms are automatically cleaned up when all clients leave

### Scene-Specific AI Assistants
- Each room has dedicated STT, TTS, and RAG services
- RAG services are scene-specific, retrieving documents relevant to the current scene
- Scene IDs are used throughout the system instead of static activity IDs

## Service Architecture

Each service in the system follows a modular design:

- **ServiceController**: Manages the service lifecycle and communication
- **Child Processes**: External applications (Python scripts) that handle specific tasks
- **WebSocket Communication**: Real-time data streaming between services

## Development

### Adding New Services

1. Create a new service directory in `Node/services/`
2. Implement the service controller extending `ServiceController`
3. Add any required Python scripts for external processing
4. Register the service in your application's pipeline

### Adding New Applications

1. Create a new application directory in `Node/apps/`
2. Implement the application controller
3. Configure the application in `config.json`
4. Create corresponding Unity scene and components

## Configuration

The system uses several configuration files:

- `.env.local`: Environment variables for the Node.js server
- `config.json`: Application-specific configuration
- `secrets.yaml`: Kubernetes secrets template for deployment

## Known Issues

- Minor bug with audio WebRTC transmission between Unity client and Genie agent
- This is the primary reason this branch remains separate from main

## Deployment

See the main README.md for deployment instructions using Docker and Kubernetes.
