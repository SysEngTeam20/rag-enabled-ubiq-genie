import { ServiceController } from '../../components/service';
import { NetworkScene } from 'ubiq';
import path from 'path';
import { fileURLToPath } from 'url';

export class TextToSpeechService extends ServiceController {
    constructor(scene: NetworkScene) {
        super(scene, 'TextToSpeechService');

        this.registerChildProcess('default', 'python', [
            '-u',
            path.join(path.dirname(fileURLToPath(import.meta.url)), 'text_to_speech_ibm.py')
        ]);
    }
}
