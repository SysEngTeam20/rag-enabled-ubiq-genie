import os
import sys
import wave
import struct
from ibm_watson import TextToSpeechV1
from ibm_cloud_sdk_core.authenticators import IAMAuthenticator
import datetime
import traceback
import io

def initialize_speech_synthesizer():
    try:
        # Hardcoded credentials for testing
        authenticator = IAMAuthenticator('HdACGo0on0ZsvIjuqwYBjq6kDk1TSLt7p3vycCsAycz7')
        text_to_speech = TextToSpeechV1(
            authenticator=authenticator
        )
        text_to_speech.set_service_url('https://api.eu-gb.text-to-speech.watson.cloud.ibm.com/instances/3e7c35d2-5dbf-4e0f-a49f-dab1618a3fd1')
        return text_to_speech
    except Exception as e:
        print(f"[TTS] ERROR initializing: {str(e)}")
        traceback.print_exc()
        return None

def transcribe_speech(text, synthesizer):
    try:
        # Debug logging
        print(f"[TTS] Received text to synthesize: '{text}'")
        
        # Create logs directory if it doesn't exist
        script_dir = os.path.dirname(os.path.abspath(__file__))
        log_dir = os.path.join(script_dir, "logs")
        os.makedirs(log_dir, exist_ok=True)
        
        # Generate unique filename with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_text = ''.join(c if c.isalnum() else '_' for c in text[:20])
        filename = f"{timestamp}_{safe_text}.wav"
        filepath = os.path.join(log_dir, filename)
        
        print(f"[TTS] Will save to: {filepath}")
        
        # Clean up the message - remove debug info that might be in the text
        clean_text = text
        if '[DEBUG' in clean_text or '[IBM]' in clean_text:
            parts = clean_text.split('[DEBUG')
            clean_text = parts[0].strip()
            print(f"[TTS] Cleaned text to: '{clean_text}'")
        
        # Critical change: Request PCM L16 audio at 48kHz to match WebRTC expectations
        result = synthesizer.synthesize(
            clean_text,
            voice='en-GB_KateV3Voice',
            accept='audio/l16;rate=48000'  # 16-bit PCM at 48kHz mono
        ).get_result().content
        
        # Save the raw PCM data and a WAV file for analysis
        with open(os.path.join(log_dir, f"{timestamp}_raw_pcm.raw"), 'wb') as f:
            f.write(result)
        
        # Convert the PCM to a proper WAV file for verification
        with wave.open(filepath, 'wb') as wf:
            wf.setnchannels(1)  # mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(48000)  # 48kHz sample rate
            wf.writeframes(result)
            
        print(f"[TTS] Synthesized {len(result)} bytes of audio data")
        print(f"[TTS] Saved WAV to {filepath} and raw PCM for verification")
        
        # Write PCM directly to stdout - Unity expects 16-bit PCM
        sys.stdout.buffer.write(result)
        sys.stdout.buffer.flush()
        
        return True
    except Exception as e:
        print(f"[TTS] ERROR: {str(e)}")
        traceback.print_exc()
        return False

def main():
    print("[TTS] Starting IBM TTS service")
    synthesizer = initialize_speech_synthesizer()
    if not synthesizer:
        print("[TTS] Failed to initialize synthesizer")
        sys.exit(1)
        
    print("[TTS] Synthesizer initialized, waiting for input")

    while True:
        try:
            text = input()
            if text.strip():
                print(f"[TTS] Processing: '{text}'")
                transcribe_speech(text, synthesizer)
            else:
                print("[TTS] Received empty input, skipping")
        except KeyboardInterrupt:
            print("[TTS] Speech synthesis stopped.")
            break
        except Exception as e:
            print(f"[TTS] Unexpected error: {str(e)}")
            traceback.print_exc()

if __name__ == "__main__":
    main() 