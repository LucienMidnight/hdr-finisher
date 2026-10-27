"""CPU reference pixels for the isolated shared-selection GPU driver."""
import json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from hdr_finisher.hsl import HSLRange, from_lab, selection, to_lab
from hdr_finisher.hsl_selection import geometry, prepare, select

rng = np.random.default_rng(42)
h, w = 129, 257
lab = np.zeros((h, w, 3), np.float32); lab[..., 0] = .6
angle = np.radians(109 + rng.normal(0, 18, (h, w)))
lab[..., 1] = .12 * np.cos(angle); lab[..., 2] = .12 * np.sin(angle)
lab[:, 160:, 1:] = 0
rgb = from_lab(lab).astype(np.float32)
rgb[:, 158:160] *= 8  # a bright edge of the patch: selected with it, not left out


def fields(pixels):
    v = to_lab(pixels).astype(np.float32)
    light = np.maximum(np.abs(v[..., 0]), 1e-6)
    return np.concatenate((v[..., 1:] / light[..., None], np.log2(np.maximum(light, 1e-4))[..., None],
                           np.ones_like(light)[..., None]), axis=-1).astype(np.float32)


yellow = [HSLRange(center=109, width=15, feather=21)]
wide = [HSLRange(center=109, width=24, feather=41), HSLRange(center=60, width=10, feather=10, subtract=True)]
channels = [dict(ranges=[r.model_dump() for r in yellow], floor=.02),
            dict(ranges=[r.model_dump() for r in wide], floor=.04)]
cases = []
full = prepare(rgb)
cases.append(dict(name='full', x=0, y=0, width=w, height=h, scale=1,
                  weights=[select(full, yellow).tolist(), select(full, wide, .04).tolist()]))
# A tile with halo: its interior must match the whole frame.
reach = geometry(1).reach
tx, ty, tw, th = 61, 37, 120, 60
x0, y0 = tx - reach, max(0, ty - reach)
x1, y1 = tx + tw + reach, min(h, ty + th + reach)
tile = prepare(rgb[y0:y1, x0:x1], 1, (x0, y0))
cases.append(dict(name='tile', x=x0, y=y0, width=x1 - x0, height=y1 - y0, scale=1,
                  interior=[tx - x0, ty - y0, tw, th],
                  weights=[select(tile, yellow).tolist(), select(tile, wide, .04).tolist()]))
half = prepare(rgb, .5)
cases.append(dict(name='half-scale', x=0, y=0, width=w, height=h, scale=.5,
                  weights=[select(half, yellow).tolist(), select(half, wide, .04).tolist()]))
weight = cases[0]['weights'][0] = np.asarray(cases[0]['weights'][0])
tile_weight = np.asarray(cases[1]['weights'][0])
before = selection(rgb, yellow)[0]
seam = float(np.abs(tile_weight[ty - y0:ty - y0 + th, tx - x0:tx - x0 + tw] - weight[ty:ty + th, tx:tx + tw]).max())
cases[0]['weights'][0] = weight.tolist()
# Exercise every edge control on the full frame, half scale, and a halo tile.
for edge, feather, detail in [(-3,0,50),(3,0,50),(0,6,50),(0,0,0),(0,0,100),(8,16,100),(-8,16,0),(.75,.5,25)]:
    controls=dict(edge=edge,edge_feather=feather,edge_detail=detail)
    cs=[dict(c,**controls) for c in channels]
    for scale in (1,.5):
        prepared=prepare(rgb,scale)
        weights=[select(prepared,yellow,**controls),select(prepared,wide,.04,**controls)]
        cases.append(dict(name=f'edge-{edge}-{feather}-{detail}-scale-{scale}',x=0,y=0,width=w,height=h,scale=scale,
                          channels=cs,weights=[v.tolist() for v in weights]))
        halo=geometry(scale).reach + int(np.ceil(abs(edge)*scale)) + int(np.ceil(2*feather*scale))
        x0,y0=max(0,tx-halo),max(0,ty-halo)
        x1,y1=min(w,tx+tw+halo),min(h,ty+th+halo)
        prepared=prepare(rgb[y0:y1,x0:x1],scale,(x0,y0))
        cropped=[select(prepared,yellow,**controls),select(prepared,wide,.04,**controls)]
        for full_weights,tile_weights in zip(weights,cropped):
            np.testing.assert_allclose(tile_weights[ty-y0:ty-y0+th,tx-x0:tx-x0+tw],full_weights[ty:ty+th,tx:tx+tw],atol=1e-6)
        cases.append(dict(name=f'tile-{edge}-{feather}-{detail}-scale-{scale}',x=x0,y=y0,width=x1-x0,height=y1-y0,scale=scale,
                          interior=[tx-x0,ty-y0,tw,th],channels=cs,weights=[v.tolist() for v in cropped]))
path = Path(__file__).resolve().parents[1] / 'output/hsl-selection-engine'
path.mkdir(parents=True, exist_ok=True)
payload = dict(width=w, height=h, fields=fields(rgb).tolist(), channels=channels, cases=cases,
               tile_seam_max=seam,
               noisy_std_before=float(before[16:112, 16:140].std()),
               noisy_std_after=float(weight[16:112, 16:140].std()), selected_mean=float(weight[16:112, 16:140].mean()),
               fringe_mean=float(weight[:, 158:160].mean()), neutral_mean=float(weight[:, 180:].mean()))
(path / 'fixture.json').write_text(json.dumps(payload))
print(json.dumps({k: v for k, v in payload.items() if k not in ('fields', 'cases', 'channels')}))
