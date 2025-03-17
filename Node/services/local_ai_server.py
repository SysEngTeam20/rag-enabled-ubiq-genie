from fastapi import FastAPI, WebSocket
import numpy as np
from typing import Dict
import json

app = FastAPI()

# Store active connections
stt_connections: Dict[str, WebSocket] = {}
tts_connections: Dict[str, WebSocket] = {}

@app.websocket("/stt/ws/{client_id}")
async def websocket_stt_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    stt_connections[client_id] = websocket
    try:
        while True:
            # Receive audio data as bytes
            audio_data = await websocket.receive_bytes()
            
            # Convert to numpy array and transcribe
            audio_np = np.frombuffer(audio_data, dtype=np.float32)
            segments, info = whisper_model.transcribe(audio_np)
            text = " ".join([segment.text for segment in segments])
            
            # Send back transcription
            await websocket.send_json({"text": text})
    except Exception as e:
        print(f"Error in STT websocket: {e}")
    finally:
        del stt_connections[client_id]

@app.websocket("/tts/ws/{client_id}")
async def websocket_tts_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    tts_connections[client_id] = websocket
    try:
        while True:
            # Receive text
            data = await websocket.receive_json()
            text = data["text"]
            
            # Generate audio
            audio_tensor = tts_model.generate(text)
            
            # Convert to bytes and send
            audio_data = audio_tensor.cpu().numpy().tobytes()
            await websocket.send_bytes(audio_data)
    except Exception as e:
        print(f"Error in TTS websocket: {e}")
    finally:
        del tts_connections[client_id] 