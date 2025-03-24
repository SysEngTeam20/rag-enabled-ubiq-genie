#!/usr/bin/env python3
import sys
import json
import argparse
import websocket
import threading
import time
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def log(message):
    """Log a message with timestamp"""
    # Skip logging empty lines and zero byte messages
    if not message or message.startswith('Received empty line') or message.startswith('Received 0 bytes'):
        return
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f"[DEBUG] {timestamp} - {message}", flush=True)

class LocalSTTClient:
    def __init__(self, peer_id, activity_id, debug=False):
        self.peer_id = peer_id
        self.activity_id = activity_id
        self.debug = debug
        self.ws = None
        self.connected = False
        self.server_url = f"ws://localhost:5001/stt/ws/{activity_id}"
        
    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            if data.get('type') == 'transcription':
                transcription = data.get('text', '')
                if transcription:
                    log(f"Received transcription: {transcription}")
                    # Send transcription to Node.js process
                    sys.stdout.write(f">{transcription}\n")
                    sys.stdout.flush()
        except Exception as e:
            log(f"Error processing message: {e}")
            
    def on_error(self, ws, error):
        """Handle WebSocket errors"""
        log(f"WebSocket error: {error}")
        self.connected = False
        
    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket connection close"""
        log(f"WebSocket connection closed: {close_status_code} - {close_msg}")
        self.connected = False
        
    def on_open(self, ws):
        """Handle WebSocket connection open"""
        log("WebSocket connection established")
        self.connected = True
        
    def connect(self):
        """Connect to the STT server"""
        log(f"Connecting to WebSocket server: {self.server_url}")
        self.ws = websocket.WebSocketApp(
            self.server_url,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
            on_open=self.on_open
        )
        # Start WebSocket connection in a separate thread
        wst = threading.Thread(target=self.ws.run_forever)
        wst.daemon = True
        wst.start()
        
        # Wait for connection with timeout
        timeout = 5
        while not self.connected and timeout > 0:
            time.sleep(0.1)
            timeout -= 0.1
            log("Waiting for WebSocket connection...")
            
        if not self.connected:
            log("Failed to connect to STT server")
            return False
            
        log("Successfully connected to STT server")
        return True

def main():
    parser = argparse.ArgumentParser(description='Local STT Client')
    parser.add_argument('--peer', required=True, help='Peer ID')
    parser.add_argument('--activity_id', required=True, help='Activity ID')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    
    log(f"Starting Local STT Client for peer: {args.peer} with activity ID: {args.activity_id}")
    
    # Initialize STT client
    client = LocalSTTClient(args.peer, args.activity_id, args.debug)
    
    # Connect to STT server
    if not client.connect():
        log("Failed to connect to STT server")
        sys.exit(1)
        
    log("STT client initialized successfully")
    
    try:
        # Read audio data from stdin
        bytes_read = 0
        while True:
            try:
                # Read raw audio data (PCM format)
                audio_data = sys.stdin.buffer.read(4800)  # 100ms of audio at 48kHz
                if not audio_data:
                    break
                    
                bytes_read += len(audio_data)
                if bytes_read < 10000:  # Log first few chunks
                    log(f"Read {len(audio_data)} bytes from stdin (total: {bytes_read})")
                    
                # Send audio data to STT server
                if client.connected and client.ws:
                    try:
                        # Send as binary data
                        client.ws.send(audio_data, websocket.ABNF.OPCODE_BINARY)
                        if bytes_read < 10000:  # Log first few sends
                            log(f"Sent {len(audio_data)} bytes to STT server")
                    except Exception as e:
                        log(f"Error sending audio data to STT server: {e}")
                else:
                    log("WebSocket not connected, dropping audio data")
                    
            except Exception as e:
                log(f"Error processing audio data: {e}")
                time.sleep(0.1)  # Prevent tight loop on error
                
    except KeyboardInterrupt:
        log("Shutting down...")
    finally:
        if client.ws:
            client.ws.close()
            log("WebSocket connection closed")

if __name__ == "__main__":
    main() 