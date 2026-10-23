"""Reproducible synthetic comparison. Run from codebase with its venv Python."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import json
import base64
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from hdr_finisher.retouch import CpuInpaint, _patch_mean
from hdr_finisher.retouch_recipe import InpaintRecipe, prepare_repair

OUT = Path("output/retouch-detail-study")
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(42)
y, x = np.mgrid[:256, :256]
noise = rng.normal(0, .018, (256, 256, 1)).astype(np.float32)
base = np.stack([.32 + x*.0005 + y*.0002, .40+x*.0004, .48+y*.0003], -1).astype(np.float32)
texture = noise + (.012*np.sin(x*1.8) + .008*np.sin(y*1.3))[..., None]
clean = base + texture
rad = np.hypot(x-128, y-128)
blotch = np.maximum(0, 1-(rad/50)**2)**2
cases = {
    "Luminance blotch - original grain survives": clean - .18*blotch[..., None],
    "Opaque object - original detail is hidden": np.where(((abs(x-128)<27)&(abs(y-128)<38))[...,None], .10, clean),
    "Fine patterned surface - texture alignment matters": clean + .025*np.sin(x*.35)[...,None] - .18*blotch[...,None],
}
methods = [
 ("Clean reference", "Known truth; used only for comparison"),
 ("Damaged input", "What the brush must correct"),
 ("A - Soft brush 10%", "Current large-brush reconstruction"),
 ("B - Edge feather", "75% full interior; soft outer 25%"),
 ("C - Original detail", "Replace tone; retain input microdetail"),
 ("D - Donor detail", "Replace tone; add clean-strip microdetail"),
]
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 16)
small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 13)
canvas = Image.new("RGB", (6*276, 3*342+76), "#171b20")
draw = ImageDraw.Draw(canvas)
draw.text((15,12), "INPAINT METHOD STUDY - SYNTHETIC CROPS, 256 x 256 NATIVE PIXELS", font=font, fill="white")
draw.text((15,39), "Prototypes C/D are research comparisons, not shipped controls. No reference pixels enter a repair.", font=small, fill="#d7c6ed")
metrics=[]
for row, (title, dirty) in enumerate(cases.items()):
    truth = clean if row != 2 else clean + .025*np.sin(x*.35)[...,None]
    dirty = dirty.astype(np.float32)
    def solve(hardness):
        recipe = InpaintRecipe(source_size=(256,256), search_rect=(0,0,256,256), points=[dict(x=.5,y=.5)],
            radius_px=82, hardness=hardness, settings=dict(seed=42,patch_radius=3,iterations=6))
        req=prepare_repair(recipe,lambda *args: dirty)
        patch=CpuInpaint().solve(req,recipe.settings)
        out=dirty.copy();px,py=patch.origin;h,w=patch.pixels.shape[:2];out[py:py+h,px:px+w]=patch.pixels
        return out,req.mask
    soft,_=solve(.1)
    feather,alpha=solve(.75)
    # Undo alpha only where there is support, to compare the same filled tone.
    fill=dirty.copy();nz=alpha>0
    fill[nz]=(feather[nz]-dirty[nz]*(1-alpha[nz,None]))/alpha[nz,None]
    original_hf=dirty-_patch_mean(dirty,2)
    donor_hf=original_hf[:, x[0]%40] # clean left strip, no damaged pixels
    retain=dirty*(1-alpha[...,None])+(fill+original_hf)*alpha[...,None]
    donor=dirty*(1-alpha[...,None])+(fill+donor_hf)*alpha[...,None]
    images=[truth,dirty,soft,feather,retain,donor]
    for col,(im,(name,intention)) in enumerate(zip(images,methods)):
        im=np.asarray(im,np.float32)
        region=rad<40
        lowerr=float(np.mean(np.abs((_patch_mean(im,5)-_patch_mean(truth,5))[region])))
        hf=(im-_patch_mean(im,2))[region].ravel();ref=(truth-_patch_mean(truth,2))[region].ravel()
        corr=float(np.corrcoef(hf,ref)[0,1])
        metrics.append(dict(case=title,method=name,tone_mae=lowerr,texture_correlation=corr, texture_rms_ratio=float(np.std(hf)/np.std(ref))))
        # Simple sRGB display transfer, same for every method/reference.
        rgb=np.clip(im,0,1);rgb=np.where(rgb<=.0031308,12.92*rgb,1.055*rgb**(1/2.4)-.055)
        tile=Image.fromarray(np.uint8(np.clip(rgb*255,0,255)))
        ox=col*276+10;oy=row*342+76
        draw.text((ox,oy),name,font=font,fill="white")
        draw.text((ox,oy+23),intention,font=small,fill="#b4bcc7")
        canvas.paste(tile,(ox,oy+44))
        draw.text((ox,oy+305), title[:40], font=small,fill="#e3cdf7")
        tile.save(OUT/f"case-{row+1}-method-{col}.png")
canvas.save(OUT/"comparison.png")
(OUT/"metrics.json").write_text(json.dumps(metrics,indent=2))
# Standalone viewer keeps the source images and method labels together.
tiles = [["data:image/png;base64,"+base64.b64encode((OUT/f"case-{row+1}-method-{col}.png").read_bytes()).decode()
          for col in range(6)] for row in range(3)]
data=json.dumps(dict(images=tiles,methods=methods,cases=list(cases),metrics=metrics))
html = """<!doctype html><meta charset="utf-8"><title>Inpaint method comparison</title>
<style>body{background:#171b20;color:#eef0f4;font:17px system-ui;max-width:1200px;margin:32px auto;padding:0 24px}h1{font-size:26px}p{max-width:950px;line-height:1.5}select,button{background:#303941;color:white;padding:10px;border:1px solid #88909a;margin:4px}section{display:flex;gap:20px;flex-wrap:wrap}figure{margin:15px 0}img{width:320px;image-rendering:auto}figcaption{padding-bottom:8px}a{color:#dbc2ff}td,th{padding:8px;text-align:left;border-bottom:1px solid #59616b}.note{color:#c4ccd6;font-size:15px}</style>
<h1>Inpaint: feather and texture comparison</h1>
<p>Synthetic test crops with a known clean reference. These experiments investigate broad defects while preserving noise and texture. Methods B–D are comparisons; they are not new app controls.</p>
<label>Case <select id="case"></select></label><label>Method <select id="method"></select></label>
<p id="intent"></p><section><figure><figcaption>Clean reference</figcaption><img id="clean"></figure><figure><figcaption>Damaged input</figcaption><img id="dirty"></figure><figure><figcaption id="chosen"></figcaption><img id="result"></figure></section>
<p id="finding"></p><table><thead><tr><th>Method</th><th>Tone error ↓</th><th>Original texture correlation ↑</th><th>Texture strength / reference</th></tr></thead><tbody id="metrics"></tbody></table>
<p class="note">Measurements cover the central 40-pixel radius. Tone error is mean absolute error after an 11×11 box average in linear RGB. Texture is the residual after a 5×5 box average. Correlation measures whether original fine detail stays aligned; donor noise can look appropriate without matching the reference noise pixel for pixel. These are descriptive measures, not a perceptual quality pass/fail test. No clean reference pixels enter any repair.</p>
<p><b>Recommendation:</b> make Preserve texture optional for broad luminance changes. Use donor detail when an object covers the original surface; preserving original detail retains that object's outline. Edge feather should control the transition independently of interior correction strength. The clean-strip donor here is a controlled prototype, not a validated automatic donor selector.</p>
<p>Research basis: <a href="https://docs.darktable.org/usermanual/development/en/darkroom/processing-modules/wavelets/">darktable frequency separation</a> and <a href="https://github.com/darktable-org/dtdocs/blob/master/content/module-reference/processing-modules/retouch.md">retouch documentation</a>. Method C uses a simple two-band box-filter split, not darktable's complete wavelet implementation.</p>
<script>const study=STUDY_DATA;const c=document.getElementById('case'),m=document.getElementById('method');study.cases.forEach((v,i)=>c.add(new Option(v,i)));study.methods.slice(2).forEach((v,i)=>m.add(new Option(v[0],i+2)));m.value=4;
function show(){const row=+c.value,col=+m.value;document.getElementById('intent').textContent=study.methods[col][1];['clean','dirty','result'].forEach((id,i)=>document.getElementById(id).src=study.images[row][i===2?col:i]);document.getElementById('chosen').textContent=study.methods[col][0];document.getElementById('finding').textContent=['Luminance blotch: original-detail preservation keeps the surviving fine grain while correcting broad tone.','Opaque object: original-detail preservation retains a visible outline. The fine texture underneath is unavailable and must be replaced.','Patterned surface: original-detail preservation keeps alignment better. The clean-strip donor has the wrong pattern phase.'][row];document.getElementById('metrics').innerHTML=study.metrics.filter(v=>v.case===study.cases[row]).slice(2).map(v=>'<tr><td>'+v.method+'</td><td>'+v.tone_mae.toFixed(4)+'</td><td>'+v.texture_correlation.toFixed(3)+'</td><td>'+v.texture_rms_ratio.toFixed(2)+'</td></tr>').join('');}c.onchange=m.onchange=show;show();</script>"""
(OUT/"comparison.html").write_text(html.replace("STUDY_DATA",data),encoding="utf-8")
print("Wrote labeled comparison.png, standalone comparison.html and metrics.json to",OUT)

