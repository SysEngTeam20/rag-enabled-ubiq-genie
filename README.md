# Conversational Agent System (Ubiq-Genie Fork)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Fork Note**: This project extends the [Ubiq-Genie](https://github.com/ubicomplab/ubiq-genie) framework with local LLM integration and enhanced RAG capabilities.

A real-time voice AI agent with document context awareness powered by:

- Local LLM inference (Llama.cpp compatible)
- Retrieval-Augmented Generation (RAG)
- Secure JWT-authenticated document access

## Features

- 🎙️ **Voice Interface**: Real-time STT/TTS conversion
- 🧠 **Local Inference**: Private processing via compiled LLM server
- 📚 **Context Awareness**: FAISS vector store (lines 46-72 `rag_service.py`)
- 🔒 **Secure Access**: JWT document fetching (lines 88-100 `rag_service.py`)
- 👥 **Multi-User**: Concurrent conversation tracking (lines 13-18 `app.ts`)

## System Architecture

```mermaid
graph TD
    A[User Voice] --> B{Speech-to-Text}
    B --> C[RAG Context]
    C --> D[Local LLM]
    D --> E[Response Gen]
    E --> F{Text-to-Speech}
    F --> G[Output]
    C -->|No Docs| D
```

## Requirements

### Core Dependencies
- Python 3.10+
- Node.js 20+
- FAISS vector store
- Sentence-transformers

### Local LLM Server

Please refer to the [Local LLM Server repository](https://github.com/SysEngTeam20/native-granite-compilation) for instructions on how to compile and run the local LLM server.

### ElectronJS App and Document Server

Please refer to the [ElectronJS app repository](https://github.com/SysEngTeam20/portalt-portal) for instructions on how to compile and run the ElectronJS app, which includes the Document Server.

## Quick Start

1. **Clone & Setup**
```bash
git clone https://github.com/SysEngTeam20/rag-enabled-ubiq-genie.git
cd rag-enabled-ubiq-genie
pip install -r requirements.txt
npm install
```

2. **Configure Environment** (`.env.local`)

Create `.env.local` in your project root with these required variables:

```ini
# API Configuration
API_BASE_URL=http://localhost:3000  # Base URL for document API
API_SECRET_KEY=yrFvjWY7a6RUEZyu      # JWT signing secret (must match document server)

# LLM Configuration
LLM_SERVER=http://localhost:8080     # Local LLM server endpoint
LLM_PORT=8080                        # Default port for LLM server

# Activity Configuration  
ACTIVITY_ID=  # Default activity ID for document retrieval

# STT & TTS Configuration
IBM_STT_API_KEY=  # IBM Speech-to-Text API key
IBM_TTS_API_KEY=  # IBM Text-to-Speech API key
```

### Variable Details

| Variable | Required | Description | Example | Code Reference |
|----------|----------|-------------|---------|----------------|
| `API_BASE_URL` | Yes | Base URL for document API | `http://doc-server:3000` | `rag_service.py:88` |
| `API_SECRET_KEY` | Yes | JWT signing secret (32+ chars) | `secure-secret-123` | `service.ts:20` |
| `LLM_SERVER` | Yes | LLM server host/port | `http://192.168.1.10:8080` | `rag_service.py:146` |
| `LLM_PORT` | Yes | LLM server port | `8080` | `app.ts:13` |
| `ACTIVITY_ID` | Yes | Default activity ID, to be generated by the ElectronJS app's api | `0742fc56-8e73-4d73-9488-60a3d936351b` | `service.ts:8` |
| `IBM_STT_API_KEY` | No | IBM Speech-to-Text API key | `your-ibm-key` | `app.ts:22` |
| `IBM_TTS_API_KEY` | No | IBM Text-to-Speech API key | `your-ibm-key` | `app.ts:31` |

> **Security Note**: Keep `API_SECRET_KEY` and IBM keys confidential. Never commit them to version control.

3. **Launch System**

```bash
# Start Node.js Agent
cd Node/apps/conversational_agent
npm start
```

## Testing

**Direct LLM Test**:

**RAG Pipeline Test**:
```bash
python test-rag.py --query "What's our return policy?" \
  --activity_id retail-docs
```

## Documentation

| Component | Key Files | 
|-----------|-----------|
| RAG Service | `rag_service.py` (lines 46-175) |
| Text Generation | `service.ts` (lines 8-48) | 
| Agent Core | `app.ts` (lines 13-38) |

## License

MIT License - See [LICENSE](LICENSE)

## Acknowledgements

This project is a fork of the Ubiq-Genie framework:
- Original Paper: [Ubiq-Genie: Framework for Developing Mixed Reality Experiences](https://ubiq.online/publication/ubiq-genie/)
- Demo Video: [YouTube Walkthrough](https://youtu.be/cGz0z9BIgQk)
- Parent Repository: [Ubiq-Genie GitHub](https://github.com/ubicomplab/ubiq-genie)