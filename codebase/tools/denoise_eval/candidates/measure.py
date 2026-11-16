"""One reproducible full harness run with all classical strength variants."""
import numpy as np
from PIL import Image
from tools.denoise_eval import metrics, run


def save_review_image(image, path):
    pixels = np.uint8(np.rint(np.clip(metrics.display(image), 0, 1)*255))
    thumbnail = Image.fromarray(pixels)
    thumbnail.thumbnail((128, 128), Image.Resampling.LANCZOS)
    thumbnail.save(path, optimize=True)


def adapters():
    prefix = 'tools.denoise_eval.candidates.'
    return ['off', 'denoise_v2', prefix+'denoise_v2_tuned:factory', prefix+'denoise_v2_tuned:sharp',
            *[prefix+'darktable_profiled:'+factory for factory in ('half', 'three_quarters', 'factory')],
            *[prefix+'galosh:'+factory for factory in ('half', 'three_quarters', 'factory', 'blind_half', 'blind_three_quarters', 'blind')]]


if __name__ == '__main__':
    run.save_image = save_review_image
    run.main(['--set', 'full', '--adapters', ','.join(adapters())])
