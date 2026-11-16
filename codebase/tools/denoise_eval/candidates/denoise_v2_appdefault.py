"""Current Denoise at the app's shipping defaults (Detail Recovery 0.0).

`DenoiseLiveControls` in `backend/hdr_finisher/models.py` ships Detail Recovery
at 0.0, while the research reference `AdaptiveControls` defaults it to 0.5.
This adapter measures what a user actually gets when switching Denoise on.
"""
from dataclasses import asdict
from tools.denoise_eval.adapters import DenoiseV2


class AppDefault(DenoiseV2):
    def __init__(self):
        super().__init__({'detail_recovery': 0.0})

    def description(self):
        return dict(algorithm='adaptive-atrous-v1', input_kind=self.input_kind,
                    controls=asdict(self.controls), note='app shipping defaults')


def factory():
    return AppDefault()
