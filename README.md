# Ubiq-Genie

A server-assisted collaborative mixed reality application that enables natural language interaction with AI agents in a virtual environment using the [Ubiq](https://ubiq.online) framework.

## Branch Note

This is the `multi-room-support` branch, which enables concurrent activities with multiple rooms (1 room = 1 scene). While this branch offers better scalability for multiple concurrent activities, it currently has a minor bug with audio WebRTC transmission between the Unity client and the Genie agent. This is why it remains as a separate branch from main.

The main branch is the stable single-room version, where the agent can only be in one room and trained on documents related to a single activity.

## Features

- **Multi-Room Support**: Multiple concurrent activities with dedicated agents per room
- **Multi-User**: Multiple users can interact with agents in the same room
- **Real-time Communication**: WebRTC-based audio streaming and WebSocket for text
- **Local LLM Integration**: Powered by [compiled-granite-server](https://github.com/SysEngTeam20/compiled-granite-server)
- **Speech Recognition**: Real-time STT using Whisper
- **Text-to-Speech**: Natural voice responses
- **Document Context**: RAG-based context for each room's activity

## Prerequisites

- Node.js 20.x
- Python 3.10+
- Unity 2022.3 LTS or later
- Local LLM server running (see [compiled-granite-server](https://github.com/SysEngTeam20/compiled-granite-server))
- STT/TTS WebSocket server running (see [stt-tts-compiled-whisper-server](https://github.com/SysEngTeam20/stt-tts-compiled-whisper-server))

## Quick Start

1. Clone the repository:
```bash
git clone https://github.com/SysEngTeam20/ubiq-genie.git
cd ubiq-genie
```

2. Set up Python environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

3. Set up Node.js environment:
```bash
cd Node
npm install
```

4. Configure environment variables:
```bash
cp .env.template .env.local
# Edit .env.local with your configuration
```

5. Launch the system:
```bash
cd Node
npm start conversational_agent
```

## Environment Variables

| Variable | Required | Description | Default | Location |
|----------|----------|-------------|---------|-----------|
| `API_BASE_URL` | Yes | Base URL for API endpoints | `http://localhost:8000` | `service.ts:20` |
| `API_SECRET_KEY` | Yes | JWT signing secret (32+ chars) | `secure-secret-123` | `service.ts:20` |
| `LLM_SERVER` | Yes | Local LLM server address | `localhost` | `service.ts:8` |
| `LLM_PORT` | Yes | Local LLM server port | `8000` | `service.ts:8` |
| `ACTIVITY_ID` | Yes | Activity identifier for the room | `0742fc56-8e73-4d73-9488-60a3d936351b` | `service.ts:8` |
| `WEBSOCKET_SERVER_URL` | Yes | WebSocket server URL for STT/TTS | `ws://localhost:5001` | `service.ts:76` |
| `APP_PORT` | Yes | Main application server port | `8000` | `app.ts:15` |

## Architecture

### Components

1. **Unity Client**
   - VR interface for user interaction
   - WebRTC audio streaming
   - Room management

2. **Node.js Server**
   - Room coordination
   - Service management
   - WebSocket communication

3. **Python Services**
   - Speech-to-Text (Whisper)
   - Text-to-Speech
   - Audio processing

4. **External Services**
   - Local LLM server
   - STT/TTS WebSocket server

### Room Management

Each room in the system:
- Has its own dedicated agent instance
- Maintains separate RAG context
- Supports multiple concurrent users
- Operates independently of other rooms

## Development

### Adding New Services

1. Create service directory in `Node/services/`
2. Implement service controller
3. Add required Python scripts
4. Register in application pipeline

### Adding New Applications

1. Create application directory in `Node/apps/`
2. Implement application controller
3. Configure in `config.json`
4. Create Unity scene

## Known Issues

- Minor bug with audio WebRTC transmission between Unity client and Genie agent
- This is the primary reason this branch remains separate from main

## Deployment

### Docker Deployment

1. Build the Docker image:
```bash
docker build -t ubiq-genie:latest .
```

2. Run the container:
```bash
docker run -p 8000:8000 \
  --env-file .env \
  ubiq-genie:latest
```

### Kubernetes Deployment on IBM Cloud

1. Install the IBM Cloud CLI and Kubernetes CLI (kubectl)

2. Log in to IBM Cloud:
```bash
ibmcloud login
```

3. Create a Kubernetes cluster (if not already created):
```bash
ibmcloud ks cluster create classic --name ubiq-genie-cluster
```

4. Get cluster credentials:
```bash
ibmcloud ks cluster config --cluster ubiq-genie-cluster
```

5. Create secrets from template:
```bash
cp k8s/secrets.template.yaml k8s/secrets.yaml
# Edit k8s/secrets.yaml with your values
kubectl apply -f k8s/secrets.yaml
```

6. Deploy the application:
```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

7. Get the external IP:
```bash
kubectl get service ubiq-genie
```

### Monitoring and Maintenance

- View logs:
```bash
kubectl logs -f deployment/ubiq-genie
```

- Scale the deployment:
```bash
kubectl scale deployment ubiq-genie --replicas=2
```

- Update the deployment:
```bash
kubectl rollout restart deployment ubiq-genie
```

- Delete the deployment:
```bash
kubectl delete -f k8s/deployment.yaml
kubectl delete -f k8s/service.yaml
kubectl delete -f k8s/secrets.yaml
```

## Related Repositories

- [compiled-granite-server](https://github.com/SysEngTeam20/compiled-granite-server) - Local LLM server
- [stt-tts-compiled-whisper-server](https://github.com/SysEngTeam20/stt-tts-compiled-whisper-server) - STT/TTS WebSocket server
- [portalt-admin-app](https://github.com/SysEngTeam20/portalt-admin-app) - Admin app for managing activities and rooms