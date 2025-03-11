import os
import sys
import wave
from ibm_watson import TextToSpeechV1
from ibm_cloud_sdk_core.authenticators import IAMAuthenticator

def initialize_speech_synthesizer():
    # authenticator = IAMAuthenticator(os.environ.get('IBM_TTS_API_KEY'))
    authenticator = IAMAuthenticator('HdACGo0on0ZsvIjuqwYBjq6kDk1TSLt7p3vycCsAycz7')
    text_to_speech = TextToSpeechV1(
        authenticator=authenticator
    )
    # text_to_speech.set_service_url(os.environ.get('IBM_TTS_SERVICE_URL'))
    text_to_speech.set_service_url('https://api.eu-gb.text-to-speech.watson.cloud.ibm.com/instances/3e7c35d2-5dbf-4e0f-a49f-dab1618a3fd1')
    return text_to_speech

def transcribe_speech(text, synthesizer):
    try:
        # Get audio from IBM Watson TTS
        # Using 48kHz audio to match Azure's configuration
        result = synthesizer.synthesize(
            text,
            voice='en-US-MichaelV3Voice',  # Similar to Azure's GuyNeural
            accept='audio/l16;rate=48000'
        ).get_result().content

        # Write to stdout
        sys.stdout.buffer.write(result)

        # Also save to wave file (for debugging/monitoring)
        with wave.open("output.wav", 'wb') as wf:
            wf.setnchannels(1)  # mono
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(48000)  # 48kHz
            wf.writeframes(result)

    except Exception as e:
        print(f"Error during speech synthesis: {str(e)}")
        print("Did you set the IBM_API_KEY and IBM_SERVICE_URL environment variables?")

def main():
    synthesizer = initialize_speech_synthesizer()

    while True:
        try:
            text = input()
            if text.strip():
                transcribe_speech(text, synthesizer)
        except KeyboardInterrupt:
            print("Speech synthesis stopped.")
            break

if __name__ == "__main__":
    main() 