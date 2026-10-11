"""Small, read-only trial; controlled softness supplements unlabeled real frames."""
import json,time,os
os.environ.setdefault("OMP_NUM_THREADS","1")
os.environ.setdefault("OPENBLAS_NUM_THREADS","1")
from pathlib import Path
import numpy as np
from hdr_finisher.library_focus import gaussian_filter,focus_map as candidate
from hdr_finisher.library_pictures import decode_picture
from PIL import Image

if __name__=='__main__':
    files=[r'D:\Photos\HDR Test Images\DSC00264.ARW',r'D:\Photos\HDR Test Images\DSC01212.ARW',r'D:\Photos\HDR Test Images\Test Suite Images\noisy_canon_IMG_0790.CR2']
    output=Path('output/focus-trial');output.mkdir(exist_ok=True);rows=[]
    for file in files:
        for quality in ['quick','native']:
            start=time.perf_counter();pixels,_,meta=decode_picture(Path(file),100000,quality);decode=time.perf_counter()-start
            start=time.perf_counter();m,noise=candidate(pixels);map_ms=(time.perf_counter()-start)*1000
            key=Path(file).stem+('-half' if quality=='quick' else '-full')
            mapmeta=dict(kind='focus',quality='half' if quality=='quick' else 'full',path=file,width=m.shape[1],height=m.shape[0],make_ms=round(decode*1000+map_ms,2))
            np.savez_compressed(output/(key+'.npz'),values=m[:,:,None],metadata=np.asarray(json.dumps(mapmeta)))
            Image.fromarray(m).save(output/(key+'.png'))
            # A known small blur at source resolution: half decode gets half the sigma.
            strengths=[]
            for source_sigma in [0,.7,1.4]:
                if source_sigma:values=gaussian_filter(pixels,(source_sigma*(.5 if quality=='quick' else 1),)*2+(0,));mm,_=candidate(values)
                else:mm=m
                strengths.append(round(float(np.mean(mm)),3))
            rows.append(dict(path=file,quality=quality,decode_ms=round(decode*1000,2),map_ms=round(map_ms,2),bytes=(output/(key+'.npz')).stat().st_size,noise=round(noise,5),peaking_means_original_slight_soft=strengths))
            print(rows[-1],flush=True)
            del pixels
    (output/'summary.json').write_text(json.dumps(rows,indent=2))
