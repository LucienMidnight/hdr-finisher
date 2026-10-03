"""Render inspectable CPU/GPU evidence for admitted masks over two levels."""
import argparse
import base64
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path("backend").resolve()))
from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
from hdr_finisher.mask_softness import bitmap_frame_rect
from hdr_finisher.models import GeometryAdjustments, MaskExpression
from soft_mask_survey import sample_bilinear

parser = argparse.ArgumentParser()
parser.add_argument("report", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
report = json.loads(args.report.read_text())
args.output.mkdir(parents=True, exist_ok=True)
evidence = []
for admitted in report["qualification"]["results"]:
    if admitted["maxLevels"] <= 2:
        continue
    index = admitted["case"]
    item = report["results"][index]
    fixture = item["qualification"]
    expression = MaskExpression.model_validate(fixture["expression"])
    geometry = GeometryAdjustments.model_validate(fixture["geometry"])
    width, height = item["width"], item["height"]
    fw, fh = fixture.get("frameWidth") or width, fixture.get("frameHeight") or height
    sw, sh = (fh, fw) if geometry.rotation % 180 else (fw, fh)
    exact = compile_geometry_fixed_mask(np.zeros((sh*3, sw*3, 3), np.float32), expression,
                                        geometry, spatial_only=True)
    bitmap = np.frombuffer(base64.b64decode(fixture["bitmap"]), np.uint8).reshape(height, width)
    rect = bitmap_frame_rect(sw*3, sh*3, sw, sh, geometry)
    ox, oy, ew, eh = rect or (0, 0, 1, 1)
    nh, nw = exact.shape
    y, x = np.mgrid[:nh, :nw].astype(np.float32)
    coverage = (np.frombuffer(base64.b64decode(fixture['textureHalf']), dtype='<f2')
                .astype(np.float32).reshape(height, width)*255
                if fixture.get('textureHalf') else bitmap.astype(np.float32))
    sampled = sample_bilinear(coverage,
        ((x+.5)/nw-ox)/ew*width-.5, ((y+.5)/nh-oy)/eh*height-.5)
    delta = sampled-exact
    worst_y, worst_x = np.unravel_index(np.abs(delta).argmax(), delta.shape)
    crop = (slice(max(0, worst_y-20), min(nh, worst_y+21)),
            slice(max(0, worst_x-20), min(nw, worst_x+21)))
    figure=Image.new('RGB',(1440,970),'#202328')
    drawing=ImageDraw.Draw(figure)
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',22)
    drawing.text((25,20),f'Trial {index}: {np.abs(delta).max():.6f} levels; {np.count_nonzero(np.abs(delta)>2)} pixels over two',font=font,fill='white')
    drawing.text((25,52),'Same mask scale: 0–255. Difference scale: blue −3 / white 0 / red +3 levels.',font=font,fill='white')
    drawing.text((25,84),'Top: full mask. Bottom: 41-pixel detail around maximum. No tolerance approval implied.',font=font,fill='white')
    for row, selection in enumerate([(slice(None), slice(None)), crop]):
        for col, (values, title) in enumerate([(exact, "Exact CPU mask"), (sampled, "GPU bitmap at native scale"),
                                              (delta, "Signed difference, levels")]):
            data=values[selection]
            if col<2:
                panel=Image.fromarray(np.clip(np.round(data),0,255).astype(np.uint8)).convert('RGB')
            else:
                signed=np.clip(data/3,-1,1)
                colors=np.stack((1-np.maximum(-signed,0),1-np.abs(signed),1-np.maximum(signed,0)),axis=-1)
                panel=Image.fromarray(np.round(colors*255).astype(np.uint8))
            panel.thumbnail((450,350),Image.Resampling.NEAREST)
            factor=min(450/panel.width,350/panel.height)
            panel=panel.resize((round(panel.width*factor),round(panel.height*factor)),Image.Resampling.NEAREST)
            left=col*480+15;top=row*410+165
            figure.paste(panel,(left+(450-panel.width)//2,top))
            drawing.text((left,row*410+130),title,font=font,fill='white')
    target = args.output / f"mask-trial-{index}.png"
    figure.save(target)
    evidence.append({**admitted, "image": str(target), "worstPixel": [int(worst_x), int(worst_y)],
                     "expression": fixture["expression"], "geometry": fixture["geometry"]})
(args.output / "manifest.json").write_text(json.dumps(evidence, indent=2)+"\n")
print(json.dumps(evidence, indent=2))
