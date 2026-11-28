"""Check continuity, neutral correction and the retained round 3 references."""
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import round4 as r


class GalleryImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.dimensions = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'img':
            attrs = dict(attrs)
            assert attrs['alt']
            self.dimensions[attrs['src']] = int(attrs['width']), int(attrs['height'])


def check_overlap(photo, rect, method):
    outer = r.prior.tile_rect(rect, photo.dims)[0]
    original = r.dxo.load_array(photo.cache, 'sensor', rect)
    inner = tuple(coord+margin for coord,margin in zip(rect,(26,26,-26,-26)))
    inner_outer = r.prior.tile_rect(inner, photo.dims)[0]
    raw = original[r.first.inset(inner_outer,outer)].copy()
    methods = {'round4': (method,1.), 'zero': (method,0.)}
    whole = r.variants(photo,rect,methods)
    with patch.object(r.dxo,'load_array',return_value=raw):
        core = r.variants(photo,inner,{'round4':(method,1.)})
    r.np.testing.assert_array_equal(whole['round3'],whole['zero'])
    expected = whole['round4'][r.first.inset(inner,rect)]
    r.np.testing.assert_allclose(core['round4'],expected,atol=5e-7,rtol=2e-6)
    return float(r.np.max(r.np.abs(core['round4']-expected)))


def verify():
    gallery = GalleryImages()
    gallery.feed((r.HERE/'review.html').read_text())
    for name,dims in gallery.dimensions.items():
        with Image.open(r.HERE/name) as crop:
            assert crop.size == dims
            assert crop.mode == 'RGB'
    assert len(gallery.dimensions) >= 75
    print(f'{len(gallery.dimensions)} linked crops have their declared 1:1 dimensions')

    for tag in r.first.NAMES:
        old = r.second.read(r.ROUND3/f'{tag}-final.json')
        new = r.second.read(r.HERE/f'{tag}-final.json')
        assert new['raw_sha256'] == old['raw_sha256']
        mode, = old['recipes']
        for patch_name, flat in old['flats'].items():
            for before,after in (('developed','developed'),('clean','clean'),(mode,'round3')):
                for channel in ('y','chroma'):
                    r.np.testing.assert_allclose(
                        list(flat[before][channel].values()),list(new['flats'][patch_name][after][channel].values()),
                        atol=1e-8,rtol=2e-6)
        config = new['methods']['round4'].copy()
        assert config.pop('strength') == 1.
        photo = r.prior.Photo(tag)
        diff = check_overlap(photo, photo.setup['flat_regions']['dark'],r.Method(**config))
        print(f'{tag} · round 3 reference reproduced · zero added strength exact · overlap {diff:.2g}')

    atrium = r.second.read(r.HERE/'atrium-final.json')['lights']
    for row in atrium.values():
        assert row['round3'] == row['round4']
    print('All three atrium light metrics are identical to round 3')
    r.dxo.peak_memory()


if __name__ == '__main__':
    verify()
