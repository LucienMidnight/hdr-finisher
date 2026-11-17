"""Current Denoise at the app's shipping defaults (Steve's D1, November 17)."""
from dataclasses import asdict
from hdr_finisher.models import DenoiseLiveControls
from tools.denoise_eval.adapters import DenoiseV2


class AppDefault(DenoiseV2):
    def __init__(self):
        super().__init__(DenoiseLiveControls().model_dump())

    def description(self):
        return dict(algorithm='adaptive-atrous-v1', input_kind=self.input_kind,
                    controls=asdict(self.controls), note='app shipping defaults')


def factory():
    return AppDefault()
