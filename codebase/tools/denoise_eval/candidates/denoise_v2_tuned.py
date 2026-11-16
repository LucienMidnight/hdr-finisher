"""Fair current-method controls selected on the recorded synthetic full set."""
import json
from pathlib import Path
from tools.denoise_eval.adapters import DenoiseV2
from hdr_finisher.denoise_adaptive import AdaptiveControls, resolve_adaptive


class Tuned(DenoiseV2):
    def __init__(self, criterion='psnr'):
        super().__init__()
        self.criterion = criterion
        self.selections = json.loads(Path(__file__).with_name('tuned_controls.json').read_text())

    def prepare(self, image, metadata):
        iso = str(metadata.get('iso', 6400))
        nearest = min(self.selections, key=lambda value: abs(int(value)-int(iso)))
        return super().prepare(image, metadata), AdaptiveControls(**self.selections[nearest][self.criterion]['controls'])

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            return image.copy()
        model, controls = state
        return resolve_adaptive(image, model, controls)

    def description(self):
        return dict(algorithm='adaptive-atrous-v1-tuned', input_kind='rgb', criterion=self.criterion,
                    selections=self.selections, real_iso_policy='nearest tested ISO, no truth at runtime')


def factory():
    return Tuned()


def sharp():
    return Tuned('sharp')
