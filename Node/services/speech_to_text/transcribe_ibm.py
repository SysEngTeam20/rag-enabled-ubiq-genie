import os
import sys
import json
import argparse
from ibm_watson import SpeechToTextV1
from ibm_watson.websocket import RecognizeCallback, AudioSource
from ibm_cloud_sdk_core.authenticators import IAMAuthenticator

class MyRecognizeCallback(RecognizeCallback):
    def __init__(self):
        RecognizeCallback.__init__(self)
        self.done = False

    def on_transcription(self, transcript):
        # Print each transcription result
        if len(transcript) > 0:
            print(">{}".format(transcript[0].get('transcript', '')))

    def on_error(self, error):
        print('Error received: {}'.format(error))
        self.done = True

    def on_inactivity_timeout(self, error):
        print('Inactivity timeout: {}'.format(error))
        self.done = True

    def on_connected(self):
        print('Connection was successful')

    def on_close(self):
        self.done = True

def recognize_from_stdin(peer):
    # Initialize the IBM Watson Speech to Text client
    authenticator = IAMAuthenticator(os.environ.get('IBM_STT_API_KEY'))
    speech_to_text = SpeechToTextV1(
        authenticator=authenticator
    )
    speech_to_text.set_service_url(os.environ.get('IBM_STT_SERVICE_URL'))

    # Create callback object
    my_callback = MyRecognizeCallback()

    # Create audio source from stdin
    audio_source = AudioSource(
        sys.stdin.buffer,
        is_recording=True,
        content_type='audio/l16; rate=48000'
    )

    # Start recognition
    speech_to_text.recognize_using_websocket(
        audio=audio_source,
        content_type='audio/l16; rate=48000',
        recognize_callback=my_callback,
        model='en-US_BroadbandModel',
        interim_results=False
    )

    # Keep reading until done
    while not my_callback.done:
        try:
            pass
        except KeyboardInterrupt:
            break

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--peer", type=str, default="00000000-0000-0000-0000-000000000000")
    args = parser.parse_args()

    recognize_from_stdin(args.peer)
    print("IBM Watson Speech client stopped receiving chunks.")

if __name__ == "__main__":
    main() 