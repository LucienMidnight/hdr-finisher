"""Bounded GPU Retouch packets on the existing delivery queue.

Native inputs always include the entire saved search rectangle, or both transfer
windows including Heal's boundary ring. Least-squares setup and seeded proposals
are shared host preparation; image search, reconstruction and finishing run on GPU.
"""
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import os
import shutil
import time
import numpy as np
from .retouch import NativeRepairInput, RepairPatch, _box_sum, _patch_mean, _tone_guide, MAX_TEXTURE_EDGE, MAX_TEXTURE_CANDIDATES
from .retouch_recipe import prepare_repair, stroke_mask
from .retouch_search import proposals


class Packet:
    def __init__(self):
        self.meta = {'input': {}, 'scratch': {}}
        self.parts = []
        self.length = 0
        self.scratch = 0

    def add(self, name, value):
        value = np.asarray(value, dtype='<f4').reshape(-1)
        self.meta['input'][name] = self.length
        self.parts.append(value)
        self.length += len(value)

    def space(self, name, count):
        self.meta['scratch'][name] = self.scratch
        self.scratch += int(count)

    def finish(self):
        self.meta.update(input_count=self.length, scratch_count=max(1, self.scratch))
        return self.meta, np.concatenate(self.parts)


def _texture(packet, image, defect, excluded, align, radius, seed, scale):
    m = packet.meta
    m['texture'] = False
    ys, xs = np.nonzero(defect)
    if max(np.ptp(ys), np.ptp(xs)) + 1 > MAX_TEXTURE_EDGE:
        return
    ring = (_box_sum(defect, 2 * radius + 2) > 0) & (_box_sum(excluded, 1) == 0)
    if not ring.any():
        return
    ih, iw = defect.shape
    y0, y1 = max(0, int(ys.min())-radius), min(ih, int(ys.max())+radius+1)
    x0, x1 = max(0, int(xs.min())-radius), min(iw, int(xs.max())+radius+1)
    h, w = y1-y0, x1-x0
    integral = np.pad(excluded.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    counts = integral[h:, w:]-integral[:-h, w:]-integral[h:, :-w]+integral[:-h, :-w]
    candidates = np.argwhere(counts == 0)
    if not len(candidates):
        return
    rng = np.random.Generator(np.random.PCG64(seed))
    if len(candidates) > MAX_TEXTURE_CANDIDATES:
        candidates = candidates[np.sort(rng.choice(len(candidates), MAX_TEXTURE_CANDIDATES, replace=False))]
    target = image[y0:y1, x0:x1].astype(np.float64)/scale
    known = ~excluded[y0:y1, x0:x1]
    if np.count_nonzero(known) < 6:
        return
    yy, xx = np.mgrid[:h, :w].astype(np.float64)
    u, v = (xx-w/2)/w, (yy-h/2)/h
    basis = np.stack((np.ones_like(u), u, v, u*u, u*v, v*v), axis=-1)
    projection = np.linalg.pinv(basis[known])
    fit = projection @ target[known]
    residual = target[known]-basis[known] @ fit if align else target[known]-target[known].mean(axis=0)
    variance = float(np.mean(residual**2))
    if variance <= 1e-30:
        return
    m.update(texture=True, tw=w, th=h, tx=x0, ty=y0, candidates=len(candidates),
             known_count=int(known.sum()), variance=variance,
             defect_count=int(defect.sum()), ring_count=int(ring.sum()))
    for name, value in [('ring', ring), ('tcandidates', candidates), ('basis', basis),
                        ('projection', projection), ('tfit', fit), ('residual', residual),
                        ('tknown', np.argwhere(known)), ('known_mask', known),
                        ('hole', defect[y0:y1, x0:x1])]:
        packet.add(name, value)
    packet.space('powers', ih*iw*2)
    packet.space('scores', len(candidates))
    packet.space('fits', len(candidates)*18)
    packet.space('choice', 5)  # enabled, candidate index, boundary correction RGB
    for name in ('donor', 'anchor', 'correction_a', 'correction_b'):
        packet.space(name, h*w*3)


def inpaint_packet(recipe, base, checkpoint):
    request = prepare_repair(recipe, lambda t,l,b,r: base[t:b,l:r], checkpoint=checkpoint)
    image, alpha, excluded = request.pixels, request.mask, request.excluded
    nh, nw = alpha.shape
    native = isinstance(request, NativeRepairInput)
    factor = 1
    if native:
        factor = 2
        while True:
            checkpoint()
            ph, pw = (-nh)%factor, (-nw)%factor
            def blocks(a):
                return a.reshape((nh+ph)//factor, factor, (nw+pw)//factor, factor)
            defect = blocks(np.pad(alpha>0, ((0,ph),(0,pw)))).any(axis=(1,3))
            if (max(defect.shape)<=128 and np.count_nonzero(defect)<=1024 and
                    np.count_nonzero(_box_sum(defect, recipe.settings.patch_radius))<=8192):
                break
            factor *= 2
        clean = ~excluded
        count = blocks(np.pad(clean, ((0,ph),(0,pw)))).sum(axis=(1,3))
        image = np.stack([blocks(np.pad(np.where(clean,image[...,c],0),((0,ph),(0,pw)))).sum(axis=(1,3),dtype=np.float64)
                          /np.maximum(count,1) for c in range(3)],axis=-1).astype(np.float32)
        excluded = blocks(np.pad(excluded, ((0,ph),(0,pw)))).any(axis=(1,3))
        alpha = defect.astype(np.float32)
    h,w = alpha.shape
    r = recipe.settings.patch_radius
    valid = _box_sum(excluded,r)==0
    valid[:r]=valid[-r:]=False
    valid[:,:r]=valid[:,-r:]=False
    sources = np.argwhere(valid)
    if not len(sources):
        raise ValueError('No complete defect-free source patch in search ROI')
    defect = alpha>0
    targets = np.argwhere(_box_sum(defect,r)>0)
    lookup = np.full((h,w),-1,dtype=np.int32)
    lookup[targets[:,0],targets[:,1]]=np.arange(len(targets))
    guide, align = _tone_guide(image,defect,excluded,r)
    scale = max(float(np.max(np.abs(image[~excluded]))),1e-12)
    source = np.where(excluded[...,None],0,image).astype(np.float64)/scale
    mean = _patch_mean(source,r)
    initial, turns = proposals(recipe.settings,(h,w),sources,len(targets))
    ys,xs = np.nonzero(request.mask)
    x0,x1,y0,y1 = int(xs.min()),int(xs.max())+1,int(ys.min()),int(ys.max())+1
    packet = Packet()
    packet.meta.update(mode='inpaint',w=w,h=h,nw=nw,nh=nh,factor=factor,scale=scale,
        align=align,radius=r,count=len(targets),x=x0,y=y0,pw=x1-x0,ph=y1-y0,
        method=recipe.method,amount=recipe.texture_amount,
        origin=[request.origin[0]+x0,request.origin[1]+y0])
    for name,value in [('image',image.astype(np.float64)/scale),('source',source),('mean',mean),
                       ('guide',guide/scale),('guide_mean',_patch_mean(guide,r)[targets[:,0],targets[:,1]]/scale),
                       ('defect',defect),('excluded',excluded),('valid',valid),('targets',targets),
                       ('lookup',lookup),('initial',initial),('native',request.pixels.astype(np.float64)/scale),
                       ('solve_alpha',request.mask),('alpha',stroke_mask(recipe,checkpoint))]:
        packet.add(name,value)
    phases=[]
    for turn in turns:
        rows=[]
        for kind,values in turn:
            offset=0
            if values is not None:
                offset=packet.length
                packet.add('proposal_'+str(offset),values)
            rows.append([kind,offset])
        phases.append(rows)
    packet.meta['phases']=phases
    packet.space('work',h*w*3)
    packet.space('field_a',len(targets)*2)
    packet.space('field_b',len(targets)*2)
    packet.space('base', (x1-x0)*(y1-y0)*3)
    _texture(packet,image,defect,excluded,align,r,recipe.settings.seed,scale)
    packet.meta['output_count']=(x1-x0)*(y1-y0)*3+len(targets)*2
    checkpoint()
    return packet.finish(), targets*factor


def transfer_packet(recipe, base, checkpoint):
    alpha=stroke_mask(recipe,checkpoint)
    yy,xx=np.nonzero(alpha>0)
    x0,x1=max(0,int(xx.min())-2),min(alpha.shape[1],int(xx.max())+3)
    y0,y1=max(0,int(yy.min())-2),min(alpha.shape[0],int(yy.max())+3)
    left,top,_,_=recipe.search_rect
    left+=x0;top+=y0
    alpha=alpha[y0:y1,x0:x1]
    h,w=alpha.shape
    width,height=recipe.source_size
    dx=(recipe.source_point.x-recipe.points[0].x)*width
    dy=(recipe.source_point.y-recipe.points[0].y)*height
    sx=np.arange(left,left+w)[None,:]+dx
    sy=np.arange(top,top+h)[:,None]+dy
    valid=(sx>=0)&(sx<=width-1)&(sy>=0)&(sy<=height-1)
    if not valid[alpha>0].all():
        raise ValueError('The source brush crosses the photo edge; choose a source farther inside')
    # Include every bilinear tap, including inactive corners and the boundary ring.
    sl=max(0,int(np.floor(sx.min())));sr=min(width,int(np.floor(sx.max()))+2)
    st=max(0,int(np.floor(sy.min())));sb=min(height,int(np.floor(sy.max()))+2)
    donor=base[st:sb,sl:sr]
    original=base[top:top+h,left:left+w]
    scale=max(float(np.max(np.abs(donor))),float(np.max(np.abs(original))),1e-12)
    gh,gw=min(h,128),min(w,128)
    unknown=alpha[np.rint(np.linspace(0,h-1,gh)).astype(int)[:,None],np.rint(np.linspace(0,w-1,gw)).astype(int)[None,:]]>0
    unknown[[0,-1],:]=False;unknown[:,[0,-1]]=False
    packet=Packet()
    packet.meta.update(mode=recipe.mode,w=w,h=h,pw=w,ph=h,gw=gw,gh=gh,sw=donor.shape[1],sh=donor.shape[0],
        sx=float(left+dx-sl),sy=float(top+dy-st),wx=1/max(1,(w-1)/(gw-1))**2,
        wy=1/max(1,(h-1)/(gh-1))**2,scale=scale,strength=recipe.strength,origin=[left,top])
    for name,value in [('original',original.astype(np.float64)/scale),('donor',donor.astype(np.float64)/scale),
                       ('alpha',alpha),('unknown',unknown)]:
        packet.add(name,value)
    packet.space('sampled',h*w*3)
    packet.space('difference',h*w*3)
    for name in ('field','solution','residual','direction','product'):
        packet.space(name,gh*gw*3)
    packet.space('control',16)
    packet.meta['output_count']=h*w*3
    checkpoint()
    return packet.finish(),np.empty((0,2),np.int32)


def packet(recipe, base, checkpoint=lambda:None):
    return inpaint_packet(recipe,base,checkpoint) if recipe.mode=='inpaint' else transfer_packet(recipe,base,checkpoint)


def solve(recipe, base, checkpoint=lambda:None, *, priority=0):
    from . import gpu_delivery as delivery
    from .delivery import preferences
    from .delivery_memory import DeliveryMemory
    if preferences()['effective_force_cpu']:
        raise RuntimeError('CPU rendering was selected.')
    root=Path(os.environ[delivery.ROOT_ENV]) if os.environ.get(delivery.ROOT_ENV) else None
    if root is None or not (root/'heartbeat').exists() or time.time()-(root/'heartbeat').stat().st_mtime>5:
        raise RuntimeError('The GPU delivery renderer is unavailable.')
    (meta,values),targets=packet(recipe,base,checkpoint)
    directory=None
    with DeliveryMemory() as memory:
        try:
            input_description,_=memory.allocate(values.shape,values)
            output_description,output=memory.allocate((meta['output_count'],))
            identity='delivery-'+uuid4().hex
            directory=root/identity;directory.mkdir()
            delivery._atomic(directory/'request.json',{'id':identity,'operation':'retouch','retouch':meta,
                'memory':{'retouch_input':input_description,'retouch':output_description},
                'priority':priority,'created':time.time()})
            def cancelled():
                checkpoint()
                return False
            frame=SimpleNamespace(delivery_cancelled=cancelled)
            reply=delivery._wait_for_result(directory,root,frame)
            while reply.get('error') in delivery.PREEMPTED_REASONS:
                for name in ('result.json','claimed'):(directory/name).unlink(missing_ok=True)
                reply=delivery._wait_for_result(directory,root,frame)
            if reply.get('error'):raise RuntimeError(reply['error'])
            checkpoint()
            if not np.isfinite(output).all():raise RuntimeError('GPU repair returned non-finite pixels.')
            size=meta['pw']*meta['ph']*3
            pixels=output[:size].reshape(meta['ph'],meta['pw'],3).copy()
            centres=output[size:].reshape(-1,2).astype(np.int32)
            pixels.flags.writeable=centres.flags.writeable=targets.flags.writeable=False
            return RepairPatch(tuple(meta['origin']),pixels,centres,targets,bool(meta.get('align')),renderer='gpu')
        finally:
            if directory is not None:
                try:(directory/'cancelled').touch()
                except OSError:pass
                shutil.rmtree(directory,ignore_errors=True)


def context_rectangles(recipe):
    """Everything a bounded job can read, in frozen native source coordinates."""
    if recipe.mode == 'inpaint':
        return [list(recipe.search_rect)]
    alpha = stroke_mask(recipe)
    yy, xx = np.nonzero(alpha > 0)
    l, t, _, _ = recipe.search_rect
    l += max(0, int(xx.min())-2); t += max(0, int(yy.min())-2)
    r = recipe.search_rect[0]+min(alpha.shape[1], int(xx.max())+3)
    b = recipe.search_rect[1]+min(alpha.shape[0], int(yy.max())+3)
    width, height = recipe.source_size
    dx = (recipe.source_point.x-recipe.points[0].x)*width
    dy = (recipe.source_point.y-recipe.points[0].y)*height
    return [[l,t,r,b], [max(0,int(np.floor(l+dx))),max(0,int(np.floor(t+dy))),
                         min(width,int(np.floor(r-1+dx))+2),min(height,int(np.floor(b-1+dy))+2)]]


class BoundedSource:
    """A native source reader that rejects every undeclared dependency."""
    def __init__(self, rectangles, values):
        self.regions=[]
        cursor=0
        for l,t,r,b in rectangles:
            count=(r-l)*(b-t)*3
            if count <= 0: raise ValueError('Invalid repair source rectangle')
            self.regions.append(((l,t,r,b),values[cursor:cursor+count].reshape(b-t,r-l,3)))
            cursor+=count
        if cursor != len(values):raise ValueError('Incomplete bounded repair source')

    def __getitem__(self, key):
        ys,xs=key
        for (l,t,r,b),pixels in self.regions:
            if l<=xs.start and xs.stop<=r and t<=ys.start and ys.stop<=b:
                return pixels[ys.start-t:ys.stop-t,xs.start-l:xs.stop-l]
        raise ValueError('Repair read outside its declared source context')
