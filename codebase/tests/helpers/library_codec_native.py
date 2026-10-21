import sys
from pathlib import Path
import numpy as np
from PIL import Image
import pillow_heif
from library_codec_samples import jpegxl,sidecar
folder=Path(sys.argv[1])
a=np.asarray(Image.open("D:/Photos/Play_Raw/Zebras Crossing - thekman/darktable_exported/DSC_3931_01.jpg").resize((3200,1869)))
(folder/"photo.jxl").write_bytes(jpegxl.encode_sdr_jpegxl(a.astype(np.float32)/255,100))
h=pillow_heif.from_bytes("RGB",(3200,1869),a.tobytes())
p=folder/"edited.heic";h.save(p,quality=95,save_nclx_profile=True,color_primaries=1,transfer_characteristics=13,matrix_coefficients=1)
sidecar(p,edited=True)
