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
    def __init__(self, peer_id, debug=False):
        self.peer_id = peer_id
        self.debug = debug
        self.ws = None
        self.connected = False
        self.server_url = "ws://localhost:5001/stt/ws"
        
    def on_message(self, ws, message):
        """Handle incoming messages from the STT server"""
        try:
            data = json.loads(message)
            if 'text' in data and data['text'].strip():
                # Format the transcription with '>' prefix
                print(f">{data['text']}", flush=True)
                if self.debug:
                    log(f"Received transcription: {data['text']}")
        except Exception as e:
            log(f"Error processing message: {e}")
            log(f"Raw message: {message}")
            
    def on_error(self, ws, error):
        """Handle WebSocket errors"""
        log(f"WebSocket error: {error}")
        self.connected = False
        
    def on_close(self, ws, close_status_code, close_msg):
        """Handle WebSocket connection close"""
        log(f"WebSocket connection closed with status {close_status_code}: {close_msg}")
        self.connected = False
        
    def on_open(self, ws):
        """Handle WebSocket connection open"""
        log("WebSocket connection established")
        self.connected = True
        
    def connect(self):
        """Connect to the STT server"""
        websocket.enableTrace(self.debug)
        log(f"Connecting to STT server at {self.server_url}")
        
        # Add custom headers for authentication
        headers = {
            'User-Agent': 'LocalSTTClient/1.0',
            'Origin': 'http://localhost:5001'
        }
        
        self.ws = websocket.WebSocketApp(
            self.server_url,
            header=headers,
            on_message=self.on_message,
            on_error=self.on_error,
            on_close=self.on_close,
            on_open=self.on_open
        )
        
        # Start WebSocket connection in a separate thread
        wst = threading.Thread(target=self.ws.run_forever)
        wst.daemon = True
        wst.start()
        
        # Wait for connection with exponential backoff
        timeout = 5
        backoff = 0.1
        while not self.connected and timeout > 0:
            time.sleep(backoff)
            timeout -= backoff
            backoff = min(backoff * 2, 1.0)  # Exponential backoff up to 1 second
            log(f"Waiting for WebSocket connection... ({timeout:.1f}s remaining)")
            
        if not self.connected:
            log("Failed to connect to STT server")
            return False
            
        log("Successfully connected to STT server")
        return True

def main():
    parser = argparse.ArgumentParser(description='Local STT Client')
    parser.add_argument('--peer', required=True, help='Peer ID')
    parser.add_argument('--debug', action='store_true', help='Enable debug logging')
    args = parser.parse_args()
    
    log(f"Starting Local STT Client for peer: {args.peer}")
    
    # Initialize STT client
    client = LocalSTTClient(args.peer, args.debug)
    
    # Connect to STT server
    if not client.connect():
        log("Failed to connect to STT server")
        sys.exit(1)
        
    log("STT client initialized successfully")
    
    try:
        # Read audio data from stdin
        while True:
            try:
                # Read raw audio data (PCM format)
                audio_data = sys.stdin.buffer.read(4800)  # 100ms of audio at 48kHz
                if not audio_data:
                    break
                    
                # Send audio data to STT server
                if client.connected and client.ws:
                    client.ws.send(audio_data)
                    
            except Exception as e:
                log(f"Error processing audio data: {e}")
                time.sleep(0.1)  # Prevent tight loop on error
                
    except KeyboardInterrupt:
        log("Shutting down...")
    finally:
        if client.ws:
            client.ws.close()

if __name__ == "__main__":
    main() 