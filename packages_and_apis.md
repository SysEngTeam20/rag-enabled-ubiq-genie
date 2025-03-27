# Packages and APIs

## Core Framework Dependencies

### 1. Ubiq Framework
**Version**: Latest
**Purpose**: Core networking and multiplayer functionality
**Key Components**:
- `ubiq-server`: Server-side networking components
- `ubiq`: Client-side networking components
**Usage**:
- Real-time communication
- Room management
- Peer connections
- State synchronization

### 2. Node.js Dependencies
**Version**: Node.js 20+
**Core Packages**:
- `ws`: WebSocket client/server
- `nconf`: Configuration management
- `dotenv`: Environment variable management
- `child_process`: Process management
- `EventEmitter`: Event handling

## AI and Processing Services

### 1. Speech Processing
**Whisper Integration**
- **API**: Local Whisper API
- **Features**:
  - Speech-to-Text conversion
  - Multi-language support
  - Real-time transcription
  - Voice synthesis

### 2. Language Model
**Granite LLM**
- **Version**: 3.2B Quantized
- **API**: Local REST API
- **Features**:
  - Local inference
  - Context-aware generation
  - Resource optimization
  - Low latency processing

### 3. RAG Service
**Components**:
- FAISS vector store
- Sentence-transformers
- Local document processing
- Context retrieval system

## Media Processing

### 1. WebRTC
**Package**: `@roamhq/wrtc`
**Purpose**: Real-time audio/video streaming
**Features**:
- Peer-to-peer communication
- Audio streaming
- Connection management
- Media synchronization

### 2. Audio Processing
**Components**:
- RTCAudioData handling
- Audio buffer management
- Stream processing
- Real-time audio conversion

## Development Tools

### 1. TypeScript Configuration
**Version**: ESNext
**Key Settings**:
```json
{
    "target": "ESNext",
    "module": "ESNext",
    "strict": true,
    "esModuleInterop": true,
    "moduleResolution": "node"
}
```

### 2. Build Tools
- TypeScript compiler
- Node.js package manager
- Docker containerization
- Environment configuration

## API Endpoints

### 1. Ubiq Server APIs
**WebSocket Endpoints**:
- `/ws/room`: Room management
- `/ws/peer`: Peer connection handling
- `/ws/media`: Media streaming

**REST Endpoints**:
- `/api/room`: Room configuration
- `/api/peer`: Peer management
- `/api/service`: Service control

### 2. Service APIs
**Whisper Service**:
- `POST /stt`: Speech-to-Text conversion
- `POST /tts`: Text-to-Speech synthesis

**RAG Service**:
- `POST /query`: Context-aware querying
- `GET /context`: Context retrieval
- `POST /update`: Document updates

**LLM Service**:
- `POST /generate`: Text generation
- `POST /embed`: Text embedding
- `GET /status`: Service status

## Integration Points

### 1. Unity Integration
**Components**:
- Ubiq Unity SDK
- WebRTC Unity plugin
- Custom message handlers
- State synchronization

### 2. Storage Integration
**Components**:
- SQLite client
- IBM Cloud Object Storage SDK
- Vector store client
- Document management

### 3. Authentication
**Components**:
- Clerk SDK
- JWT handling
- Role management
- Access control

## Version Compatibility Matrix

| Component | Version | Dependencies |
|-----------|---------|--------------|
| Node.js | 20+ | - |
| Ubiq Framework | Latest | Node.js 20+ |
| Whisper | Latest | Python 3.10+ |
| Granite LLM | 3.2B | CUDA 11+ |
| WebRTC | Latest | Node.js 20+ |
| TypeScript | ESNext | Node.js 20+ |

## Security Considerations

### 1. API Security
- JWT authentication
- Rate limiting
- Input validation
- Output sanitization

### 2. Communication Security
- WebSocket encryption
- HTTPS endpoints
- Secure WebRTC
- Data validation

## Performance Requirements

### 1. API Latency
- WebSocket: < 50ms
- REST: < 100ms
- LLM: < 200ms
- STT/TTS: < 150ms

### 2. Resource Usage
- Memory: < 2GB per service
- CPU: < 50% per core
- Network: < 10MB/s per connection
- Storage: < 1GB per service 