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
        
        # Clean up the message - advanced filtering
        clean_text = text.strip()
        
        # Remove any "Agent -> User::" prefixes if they somehow got through
        if "Agent ->" in clean_text and "::" in clean_text:
            clean_text = clean_text.split("::", 1)[1].strip()
            
        # Remove confidence scores and other metadata
        metadata_markers = ['[confidence:', '[DEBUG', '[IBM]', 'Agent ->', '->']
        for marker in metadata_markers:
            if marker in clean_text:
                clean_text = clean_text.split(marker)[0].strip()
        
        print(f"[TTS] Cleaned text for synthesis: '{clean_text}'")
        
        # Critical: Ensure we never send empty text to Watson
        if not clean_text or len(clean_text.strip()) == 0:
            clean_text = "I'm here to assist you."
            print(f"[TTS] Using default text because cleaned text was empty")
        
        # Create logs directory if it doesn't exist
        script_dir = os.path.dirname(os.path.abspath(__file__))
        log_dir = os.path.join(script_dir, "logs")
        os.makedirs(log_dir, exist_ok=True)
        
        # Generate unique filename with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_text = ''.join(c if c.isalnum() else '_' for c in clean_text[:20])
        filename = f"{timestamp}_{safe_text}.wav"
        filepath = os.path.join(log_dir, filename)
        
        # Final safety check before calling Watson
        synthesize_text = clean_text.strip() if clean_text.strip() else "Hello there."
        
        # Critical change: Request PCM L16 audio at 48kHz to match WebRTC expectations
        result = synthesizer.synthesize(
            synthesize_text,  # Use our validated text
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
        
        # Try with a fallback message in case of errors
        try:
            fallback_text = "I'm sorry, there was an error processing that."
            print(f"[TTS] Trying fallback message: '{fallback_text}'")
            
            fallback_result = synthesizer.synthesize(
                fallback_text,
                voice='en-GB_KateV3Voice',
                accept='audio/l16;rate=48000'
            ).get_result().content
            
            sys.stdout.buffer.write(fallback_result)
            sys.stdout.buffer.flush()
            print("[TTS] Fallback message synthesized successfully")
            
        except Exception as fallback_error:
            print(f"[TTS] Fallback also failed: {str(fallback_error)}")
        
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