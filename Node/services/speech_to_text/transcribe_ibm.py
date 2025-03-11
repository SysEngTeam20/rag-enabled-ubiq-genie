import os
import sys
import json
import argparse
import time
import traceback
import logging
from datetime import datetime

# Hardcoded IBM Watson credentials
api_key = "ux3bRMfZt5JCEWCSKnlIUAbHMjG6JwfhZr-DO2vDJtle"
service_url = "https://api.eu-gb.speech-to-text.watson.cloud.ibm.com/instances/37a7e3a4-174f-4513-80eb-d2e003bf7179"

# Set up file logging to capture all data
log_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f"watson_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")

logging.basicConfig(
    filename=log_file,
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Log all incoming data to binary file for debugging
audio_log_file = os.path.join(log_dir, f"audio_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.raw")
audio_log = open(audio_log_file, 'wb')

try:
    from ibm_watson import SpeechToTextV1
    from ibm_watson.websocket import RecognizeCallback, AudioSource
    from ibm_cloud_sdk_core.authenticators import IAMAuthenticator
except ImportError as e:
    print(f"[IBM] ERROR: Failed to import IBM Watson SDK: {e}")
    print("[IBM] Please install required packages with: pip install ibm-watson ibm-cloud-sdk-core")
    sys.exit(1)

class MyRecognizeCallback(RecognizeCallback):
    def __init__(self, peer_id, debug=False):
        RecognizeCallback.__init__(self)
        self.done = False
        self.peer_id = peer_id
        self.debug = debug
        self.session_start = time.time()
        self.last_activity = time.time()
        self.transcription_count = 0
        self.audio_chunks_received = 0
        
        if self.debug:
            print(f"[DEBUG] Recognition callback initialized for peer {peer_id}")
            
    # Add detailed logging to all events
    def on_transcription(self, transcript):
        # Update activity timestamp
        self.last_activity = time.time()
        self.transcription_count += 1
        
        # Print each transcription result with more detail
        if len(transcript) > 0:
            result = transcript[0].get('transcript', '').strip()
            if result:
                # Clean output - just print the actual transcript without debug info
                print(f">{result}")
                
                # Log debug info separately if debug mode is enabled
                if self.debug:
                    confidence = transcript[0].get('confidence', 0.0)
                    print(f"[DEBUG_ONLY] Transcription confidence: {confidence:.2f}")
                    elapsed = time.time() - self.session_start
                    print(f"[DEBUG_ONLY] Transcription #{self.transcription_count} at {elapsed:.2f}s into session")
        
    def on_connected(self):
        print(f"[IBM] CONNECTED to Watson API")
        logging.info("Connected to Watson API")
        
    def on_error(self, error):
        print(f"[IBM] ERROR: {error}")
        logging.error(f"Watson error: {error}")
        self.done = True
        
    def on_inactivity_timeout(self, error):
        print(f"[IBM] Inactivity timeout: {error}")
        logging.warning(f"Inactivity timeout: {error}")
        
    def on_listening(self):
        print(f"[IBM] Watson is now LISTENING")
        logging.info("Watson is listening")
        
    def on_hypothesis(self, hypothesis):
        print(f"[IBM] Hypothesis: {hypothesis}")
        logging.debug(f"Hypothesis: {hypothesis}")
        
    def on_data(self, data):
        # Directly log all data from Watson
        print(f"[IBM] DATA from Watson: {type(data)}")
        if isinstance(data, dict):
            if 'results' in data and data['results']:
                print(f"[IBM] Results available: {len(data['results'])}")
            else:
                print(f"[IBM] Other data: {list(data.keys())}")
        logging.debug(f"Watson data: {json.dumps(data) if isinstance(data, dict) else str(data)}")
    
    def on_close(self):
        print(f"[IBM] Connection CLOSED")
        logging.info("Connection closed")
        self.done = True

def recognize_from_stdin(peer, debug=False):
    print(f"[IBM] Starting speech recognition for peer: {peer}")
    print(f"[IBM] Using API key: {api_key[:4]}...{api_key[-4:]}")
    print(f"[IBM] Using service URL: {service_url}")
    logging.info(f"Starting speech recognition for peer: {peer}")
    
    # Log Python and package versions
    print(f"[DEBUG] Python version: {sys.version}")
    print(f"[DEBUG] IBM Watson SDK version: {getattr(SpeechToTextV1, '__version__', 'unknown')}")
    
    # Test API credentials first
    try:
        print(f"[IBM] Testing IBM Watson credentials...")
        authenticator = IAMAuthenticator(api_key)
        speech_to_text = SpeechToTextV1(
            authenticator=authenticator
        )
        speech_to_text.set_service_url(service_url)
        
        # Test API connection
        models = speech_to_text.list_models().get_result()
        print(f"[IBM] API connection successful, {len(models['models'])} models available")
    except Exception as e:
        print(f"[IBM] ERROR: Failed to connect to IBM Watson API: {e}")
        logging.error(f"API connection error: {str(e)}")
        logging.error(traceback.format_exc())
        return
    
    try:
        my_callback = MyRecognizeCallback(peer, debug)
        audio_source = AudioSource(sys.stdin.buffer)
        
        print(f"[IBM] Starting recognition with parameters:")
        print(f"[IBM] - Content type: audio/l16; rate=48000")
        print(f"[IBM] - Model: en-US_BroadbandModel")
        print(f"[IBM] - Background audio suppression: 0.5")
        print(f"[IBM] - Inactivity timeout: 60 seconds")
        
        # Start capturing audio data
        audio_bytes_received = 0
        start_time = time.time()
        last_log_time = time.time()
        audio_detected = False
        
        # Monitor the audio stream directly
        def process_audio_chunk():
            nonlocal audio_bytes_received, audio_detected, last_log_time
            
            try:
                # Try to read a chunk
                chunk = sys.stdin.buffer.read(1024)
                if not chunk:
                    return False  # No data
                
                # Log to binary file for debugging
                audio_log.write(chunk)
                audio_log.flush()
                
                # Calculate audio level to detect speech
                import array
                try:
                    # Convert to 16-bit PCM samples
                    samples = array.array('h', chunk)
                    audio_level = sum(abs(s) for s in samples) / len(samples) if samples else 0
                    
                    # Log active audio
                    if audio_level > 500:  # Arbitrary threshold for speech
                        if not audio_detected:
                            print(f"[IBM] Speech detected! Audio level: {audio_level:.2f}")
                            audio_detected = True
                    else:
                        audio_detected = False
                        
                    # Periodically log audio levels
                    now = time.time()
                    if now - last_log_time > 5:
                        last_log_time = now
                        print(f"[IBM] Audio stats: level={audio_level:.2f}, bytes received={audio_bytes_received}")
                        
                except Exception as e:
                    print(f"[DEBUG] Error processing audio samples: {e}")
                
                audio_bytes_received += len(chunk)
                return True
                
            except Exception as e:
                print(f"[IBM] Error reading audio data: {e}")
                return False
        
        # Start the Watson connection
        speech_to_text.recognize_using_websocket(
            audio=audio_source,
            content_type='audio/l16; rate=48000',
            recognize_callback=my_callback,
            model='en-US_BroadbandModel',
            interim_results=True,  # Get partial results
            background_audio_suppression=0.5,
            inactivity_timeout=60
        )
        
        print(f"[IBM] Waiting for audio data...")
        
        # Process audio directly while waiting for transcriptions
        while not my_callback.done:
            if process_audio_chunk():
                # Successfully processed some audio
                continue
            else:
                # No audio data, sleep briefly
                time.sleep(0.1)
                
            # Print status every 30 seconds
            now = time.time()
            if now - start_time > 30 and (now - start_time) % 30 < 0.5:
                elapsed = now - start_time
                print(f"[IBM] Still running after {elapsed:.1f}s, processed {audio_bytes_received} bytes of audio")
                if my_callback.transcription_count == 0:
                    print(f"[IBM] No transcriptions received yet. Check audio quality and API key.")
        
    except KeyboardInterrupt:
        print(f"[IBM] Keyboard interrupt received, stopping")
    except Exception as e:
        print(f"[IBM] ERROR: {str(e)}")
        logging.error(f"Exception: {str(e)}")
        logging.error(traceback.format_exc())
    finally:
        # Close the audio log file
        audio_log.close()
        print(f"[IBM] Audio data saved to {audio_log_file} for debugging")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--peer", type=str, default="00000000-0000-0000-0000-000000000000")
    parser.add_argument("--debug", type=str, default="false")
    args = parser.parse_args()

    debug_mode = args.debug.lower() in ('true', 't', 'yes', 'y', '1')
    print(f"[IBM] Starting Watson STT with debug={debug_mode}")
    
    recognize_from_stdin(args.peer, debug_mode)
    print("[IBM] Watson Speech client stopped receiving chunks.")

if __name__ == "__main__":
    main() 