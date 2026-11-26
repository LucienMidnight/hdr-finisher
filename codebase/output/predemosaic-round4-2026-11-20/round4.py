"""Round 4 on the signed RAW windows staged by the round 3 runner."""
import argparse
from dataclasses import asdict, dataclass
from pathlib import Path
import sys

from PIL import Image

HERE = Path(__file__).resolve().parent
ROUND3 = HERE.with_name('predemosaic-round3-2026-11-20')
sys.path.insert(0, str(ROUND3))

import trial as prior
from trial import cv2, dxo, first, np, second

LUMA = prior.LUMA
BASE = prior.recipes('balance')['balance-0.7-L0.2-C0.7']
PADDING = 64
SWEEP = (.4, .6, .8, 1., 1.15, 1.3)
cv2.setNumThreads(1)


@dataclass(frozen=True)
class Method:
    pilot: str
    fine: float = .57
    middle: float = .83
    gate: float = 1.
    raw: float = 0.
    tone: float = 0.
    tail: float = 0.
    chroma_tail: float = 0.
    anchor_limit: float = .04


METHODS = {
    'raw': Method('none', raw=.67),
    'raw-plus': Method('tensor', raw=.42),
    'uniform': Method('iso', gate=0.),
    'tensor': Method('tensor'),
    'guided': Method('guided'),
    'direction': Method('direction'),
    'direction-strong': Method('direction', fine=.66, middle=.95),
    'gated': Method('gated', fine=.45, middle=.96),
    'long': Method('long', fine=.45, middle=.96),
    'patch': Method('patch', fine=.45, middle=.96),
    'cross': Method('cross', fine=.45, middle=.96),
    'balanced': Method('balanced', fine=.43, middle=.90, tone=.85),
    'tail': Method('balanced', fine=.40, middle=.88, tone=.85, tail=.90),
    'tail-mild': Method('balanced', fine=.41, middle=.89, tone=.85, tail=.65),
    'tail-anchor': Method('balanced', fine=.40, middle=.88, tone=1., tail=.90, anchor_limit=.20),
    'tail-colour': Method('balanced', fine=.40, middle=.88, tone=1., tail=.90, chroma_tail=.8,
                          anchor_limit=.20),
}


def gaussian(plane, sigma):
    radius = int(np.ceil(3*sigma))
    size = 2*radius+1
    return cv2.GaussianBlur(plane, (size,size), sigma, borderType=cv2.BORDER_REPLICATE)


def ramp(values, low, high):
    out = np.clip((values-low)/(high-low), 0, 1)
    return out*out*(3-2*out)


def gradients(plane):
    return [cv2.Sobel(plane, -1, dx, dy, ksize=3, scale=.125,
                      borderType=cv2.BORDER_REPLICATE) for dx,dy in ((1,0),(0,1))]


def tensor(plane, sigma, support=2.1):
    dx, dy = gradients(gaussian(plane, sigma))
    xx, yy, xy = (gaussian(value, support) for value in (dx*dx,dy*dy,dx*dy))
    energy = xx+yy
    gap = np.hypot(xx-yy, 2*xy)
    return energy, gap/np.maximum(energy,1e-20), .5*np.arctan2(2*xy,xx-yy)+np.pi/2


def oriented(plane, angle, radius=7, length=3.):
    # Positive weighted line kernels sampled on an eight-direction bank.
    # Two closest directions share each output. No rotation-dependent grid.
    count = 8
    coordinates = np.arange(-radius,radius+1, dtype=np.float32)
    xx, yy = np.meshgrid(coordinates, coordinates)
    result = np.zeros_like(plane)
    for index in range(count):
        theta = index*np.pi/count
        along = xx*np.cos(theta)+yy*np.sin(theta)
        across = -xx*np.sin(theta)+yy*np.cos(theta)
        kernel = np.exp(-.5*((along/length)**2+(across/.55)**2)).astype(np.float32)
        kernel[np.abs(across)>1.5] = 0
        weight = np.maximum(0, 1-np.abs((angle-theta+np.pi/2)%np.pi-np.pi/2)/(np.pi/count))
        result += weight * cv2.filter2D(plane, -1, kernel/kernel.sum(), borderType=cv2.BORDER_REPLICATE)
    return result


def early(tile, method):
    if not method.raw:
        return
    source = tile.cells @ tile.photo.basis[0]
    fine, middle, base = [gaussian(source, sigma) for sigma in (.65,1.2,3.5)]
    energy, coherence, _ = tensor(source, 1.)
    significance = energy/np.maximum(tile.var,1e-20)
    protect = ramp(coherence,.40,.80)*ramp(significance,.008,.055)
    delta = -method.raw*(1-protect)*(.68*(source-fine)+.85*(fine-middle)+(middle-base))
    delta -= prior.box(delta, 21)
    tile.cells += np.where(tile.guard,0,delta)[...,None]*tile.inverse[:,0]


def patch_pilot(y, guide, variance):
    # Compare smoothed 3 x 3 patches at 16 points in a 13 x 13 search.
    shifts = [(dy,dx) for step in (2,6) for dy in (-step,0,step)
              for dx in (-step,0,step) if dy or dx]
    h,w = y.shape
    bounds = 6
    edge_type = cv2.BORDER_REPLICATE
    a, b = [cv2.copyMakeBorder(channel,bounds,bounds,bounds,bounds,edge_type)
            for channel in (y,guide)]
    accum = y.copy()
    norm = np.ones_like(y)
    for dy,dx in shifts:
        window = np.s_[bounds+dy:bounds+dy+h,bounds+dx:bounds+dx+w]
        error = prior.box((guide-b[window])**2, 3) / np.maximum(variance,1e-20)
        weight = (1+5*error)**-2
        accum += a[window]*weight
        norm += weight
    return accum/norm


def scene_y(tile, rect):
    # Project the original signed Bayer quad directly to a low-frequency Y reference.
    camera = tile.photo.camera
    colours = np.asarray(tile.photo.phase['colours'])
    phase_y = (camera['camera_to_acescg'].T @ LUMA)[colours]
    phase_y *= camera['as_shot_wb'][colours] / (camera['white_level']-camera['black_level'])[colours]
    phase_y *= np.asarray(tile.photo.phase['spans'], dtype=np.float32)/np.bincount(colours)[colours]
    y = (tile.cells @ phase_y.astype(np.float32)).repeat(2,axis=0).repeat(2,axis=1)
    return y[first.inset(rect,tile.outer)]


def correction(rgb, model, method, strength, guard, raw_y=None):
    if method.pilot == 'none' or strength == 0:
        return np.zeros(rgb.shape[:2], np.float32)
    y = rgb @ LUMA
    fine = gaussian(y, 1.05)
    base = gaussian(y, 5.0)
    local_y = np.maximum(fine, 0)
    variance = np.maximum(model.a*local_y + model.b + model.c*local_y**2, 1e-20)
    energy, coherence, angle = tensor(y, 1.05)
    strength_snr = energy/variance
    direction = ramp(coherence,.33,.77)*ramp(strength_snr,.003,.045)
    edge = ramp(strength_snr,.023,.16)
    protect = method.gate*np.maximum(direction,edge)
    if method.pilot in ('gated','long','patch','cross','balanced'):
        energy, coherence, angle = tensor(y, 2.0, 3.6)
        strength_snr = energy/variance
        direction = ramp(coherence,.38,.78)*ramp(strength_snr,.016,.052)
        edge = ramp(strength_snr,.023,.12)
        protect = np.maximum(direction, edge)
        if method.pilot == 'balanced':
            # The fine tensor supports edges that also stand above noise in the wider pilot.
            fine_energy, fine_coherence, _ = tensor(y, 1.15, 2.7)
            real_edge = ramp(fine_energy/variance,.23,.54)*ramp(fine_coherence,.35,.72)
            protect = np.maximum(protect, real_edge)
    if method.pilot == 'guided':
        # Local regression on a quieter guide. The denominator uses the shot/read model.
        local_var = np.maximum(prior.box(fine*fine,9)-prior.box(fine,9)**2,0)
        cross = prior.box(fine*y,9)-prior.box(fine,9)*prior.box(y,9)
        slope = np.clip(cross/(local_var+.13*variance),0,1.2)
        intercept = prior.box(y,9)-slope*prior.box(fine,9)
        structured = prior.box(slope,9)*fine+prior.box(intercept,9)
    elif method.pilot == 'direction':
        structured = oriented(y,angle)
    elif method.pilot == 'long':
        structured = oriented(y,angle,radius=12,length=5.)
    elif method.pilot == 'cross':
        # Use one orientation at two scales and keep detail where the evidence agrees.
        _, broad_coherence, broad_angle = tensor(y, 3.0, 5.)
        agreement = np.cos(angle-broad_angle)**2
        line = oriented(y,broad_angle,radius=14,length=6.)
        direction_certainty = broad_coherence * ramp(agreement,.68,.95)
        # A wider, stationary guide avoids wrapping noise around single noisy pixels.
        protect = np.maximum(protect, .65*ramp(direction_certainty,.66,.91)
                             *ramp(strength_snr,.014,.035))
        structured = line + .32*(y-line)
    elif method.pilot == 'patch':
        structured = patch_pilot(y, gaussian(y,1.65), variance)
    else:
        structured = y
    fine_gain = min(.96, strength*method.fine)
    middle_gain = min(.98, strength*method.middle)
    flat = fine_gain*(fine-y)+middle_gain*(base-fine)
    structured_gain = min(.88, strength*.71)
    delta = flat*(1-protect) + structured_gain*(structured-y)*protect
    if method.tail:
        sigma = np.sqrt(variance)
        residual = y + delta - base
        excess = np.maximum(np.abs(residual)-.85*sigma, 0)
        in_shadow = 1-ramp(base/sigma,2.3,4.0)
        delta -= np.float32(min(strength,1)*method.tail)*in_shadow*(1-protect)*np.sign(residual)*excess
    delta -= prior.box(delta, 65)
    if method.tone:
        offset = gaussian(raw_y-y, 10)
        limit = method.anchor_limit*np.sqrt(variance)
        in_shadow = 1-ramp(base/np.sqrt(variance),2.3,5.0)
        delta += min(strength,1)*method.tone*(1-protect)*in_shadow*np.clip(offset,-limit,limit)
    keep_light = 1 - prior.box(cv2.dilate(guard,np.ones((9,9),np.uint8)).astype(np.float32),9)
    return delta*keep_light


def suppress_chroma_tail(rgb, model, guard, amount):
    y = gaussian(rgb @ LUMA,1.5)
    positive = np.maximum(y,0)
    sigma = np.sqrt(np.maximum(model.a*positive + model.b + model.c*positive**2,1e-20))
    energy, _, _ = tensor(y,1.5)
    weight = amount*(1-ramp(energy/(sigma*sigma),.022,.11))*(1-ramp(y/sigma,2.6,5.))
    axes = rgb @ dxo.CHROMA.T
    residual = axes-gaussian(axes,2.5)
    magnitude = np.linalg.norm(residual,axis=-1)
    trim = np.maximum(0,1-.62*sigma/np.maximum(magnitude,1e-20))
    shift = -(weight*trim)[...,None]*residual
    shift -= prior.box(shift,65)
    keep_light = 1-prior.box(cv2.dilate(guard,np.ones((9,9),np.uint8)).astype(np.float32),9)
    return prior.GRAIN.apply_colour(rgb,shift*keep_light[...,None],1.)


def variants(photo, rect, methods):
    tile = prior.Tile(photo, rect)
    padded = first.inflate(rect, photo.dims, PADDING)
    tile.rect = padded
    raw_rgb = tile.render(BASE)
    core = first.inset(rect,padded)
    reference = raw_rgb[core].copy()
    guard = tile.wide[tile.central].repeat(2,axis=0).repeat(2,axis=1)[first.inset(padded,tile.ahd)].astype(np.uint8)
    outputs = {'round3':reference}
    for name, (method, strength) in methods.items():
        rgb = raw_rgb
        if method.raw:
            early_tile = prior.Tile(photo, rect)
            early_tile.rect = padded
            early(early_tile, method)
            rgb = early_tile.render(BASE)
        raw_y = scene_y(tile,padded) if method.tone else None
        delta = correction(rgb,photo.model,method,strength,guard,raw_y)
        result = rgb[core]+delta[core][...,None]
        np.testing.assert_allclose(
            result @ dxo.CHROMA.T, rgb[core] @ dxo.CHROMA.T, atol=1e-7, rtol=2e-5)
        if method.chroma_tail and strength:
            corrected = suppress_chroma_tail(rgb+delta[...,None],photo.model,guard,method.chroma_tail)
            np.testing.assert_allclose(corrected[core] @ LUMA, result @ LUMA, atol=1e-7,rtol=2e-5)
            result = corrected[core].copy()
        assert np.isfinite(result).all()
        outputs[name] = result
    return outputs


def area_stats(images):
    stats = prior.flat_stats(images)
    off = images['developed'] @ LUMA
    for name,rgb in images.items():
        reference = images['dxo_off'] @ LUMA if name.startswith('dxo_') else off
        stats[name]['spectrum'] = dxo.powers(reference, rgb @ LUMA)
        stats[name]['y_rms_vs_own_off'] = stats[name]['y']['rms']/stats[dxo.baseline_for(name)]['y']['rms']
    return stats


def shared_detail(images):
    if 'dxo_off' in images:
        return dxo.broad_structure(images)
    return {}


def screen(tag, methods):
    photo = prior.Photo(tag)
    result = dict(flats={}, detail={})
    for key,rect in photo.setup['flat_regions'].items():
        if key != 'texture-control':
            result['flats'][key] = area_stats(photo.images(rect) | variants(photo,rect,methods))
    for key in ('hair','face','skirt','lashes'):
        if key in photo.setup['reviews']:
            spec = photo.setup['reviews'][key]
            rect = spec['rect']
            images = photo.images(rect) | variants(photo,rect,methods)
            result['detail'][key] = shared_detail(images) or {
                name:dxo.coherence(images['developed'],rgb,spec['ev']) for name,rgb in images.items()}
            if tag != 'canon':
                for name in ('developed','clean','round3',*methods):
                    write_crop(f'screen-{tag}-{key}-{name}', images[name], spec['ev'])
    return result


def write_crop(name, rgb, ev):
    path = HERE/'crops'/f'{name}.png'
    path.parent.mkdir(exist_ok=True)
    Image.fromarray(dxo.measure.display(rgb,ev)).save(path)
    return path


def panel_specs(photo):
    specs = dict(photo.setup['reviews'])
    tag = photo.tag
    if tag == 'canon':
        specs['dark-flat'] = dict(rect=photo.setup['flat_regions']['dark'],ev=6)
        specs['dark-check'] = dict(rect=photo.setup['flat_regions']['dark-check'],ev=6)
    elif tag in ('sony','ordinary'):
        if tag == 'ordinary':
            del specs['background']
        for name in ('dark','dark-check'):
            specs['dark-flat' if name == 'dark' else name] = dict(rect=photo.setup['flat_regions'][name],ev=2)
    return specs


def save_set(tag, key, rect, ev, images, gain, order, group='comparison'):
    names = {}
    for name in order:
        rgb = images[name]
        adjusted = rgb*gain if name.startswith('dxo_') else rgb
        path = write_crop(f'{group}-{tag}-{key}-{name}',adjusted,ev)
        names[name] = path.relative_to(HERE).as_posix()
    return dict(key=key,rect=rect,ev=ev,dxo_gain=gain,images=names)


def evaluate(tag, methods, choose=None, sweep=False):
    photo = prior.Photo(tag)
    order = ['developed','clean','round3',choose] if choose else []
    if tag == 'canon' and choose:
        order.append('dxo_standard')
    result = dict(photo=photo.setup['raw_file'],iso=photo.setup['iso'],
                  raw_sha256=photo.setup['raw_sha256'], methods={
                      key:asdict(method) | dict(strength=strength) for key,(method,strength) in methods.items()},
                  flats={}, detail={}, rendition={}, rendition_display_first={}, lights={}, panels=[])
    for key,rect in photo.setup['flat_regions'].items():
        images = photo.images(rect) | variants(photo,rect,methods)
        result['flats'][key] = area_stats(images)
    for key,spec in panel_specs(photo).items():
        if sweep and key not in ('hair','face','skirt','dark-flat','floor'):
            continue
        rect, ev = spec['rect'],spec['ev']
        images = photo.images(rect) | variants(photo,rect,methods)
        gain = dxo.brightness_gain(images['developed'],images['dxo_off']) if tag == 'canon' else 1.
        if choose:
            result['panels'].append(save_set(tag,key,rect,ev,images,gain,order))
        if key in ('hair','face','skirt','flame','lashes','shirt'):
            result['detail'][key] = dict(shared=shared_detail(images), own_off={
                name:dxo.coherence(images[dxo.baseline_for(name)]*factor,rgb*factor,ev)
                for name,rgb in images.items() if (factor := (gain if name.startswith('dxo_') else 1.))})
        if key in ('face','flame','skirt'):
            adjusted = {name:rgb*gain if name.startswith('dxo_') else rgb for name,rgb in images.items()}
            result['rendition'][key] = prior.rendition(adjusted,ev)
            result['rendition_display_first'][key] = prior.rendition(adjusted,ev,True)
            if key == 'face' and tag == 'canon':
                skin = {name:rgb[first.inset(prior.SKIN,rect)] for name,rgb in adjusted.items()}
                result['rendition']['skin'] = prior.rendition(skin,ev)
                result['rendition_display_first']['skin'] = prior.rendition(skin,ev,True)
                if choose:
                    unadjusted = {name:rgb[first.inset(prior.SKIN,rect)] for name,rgb in images.items()}
                    result['panels'].append(save_set(tag,'skin',prior.SKIN,ev,unadjusted,gain,order))
        if 'light' in spec:
            point = [pos-origin for pos,origin in zip(spec['light'],rect[:2])]
            result['lights'][key] = prior.light_stats(images,point)
        if sweep and key in ('hair','dark-flat','floor'):
            result['panels'].append(save_set(tag,key,rect,ev,images,gain,
                                              ['round3','0.6','1','1.3'],group='sweep'))
    if sweep:
        return result

    rows = []
    for area_id,(rect,marks) in photo.setup['mark_regions'].items():
        images = photo.images(rect) | variants(photo,rect,methods)
        gain = dxo.brightness_gain(images['developed'],images['dxo_off']) if tag == 'canon' else 1.
        axes = {name:first.marks.display_axes(rgb*gain if name.startswith('dxo_') else rgb,photo.setup['mark_ev'])
                for name,rgb in images.items()}
        if tag == 'canon' and area_id == 'D4' and choose:
            section = (4160,2328,4416,2584)
            selected = {name:rgb[first.inset(section,rect)] for name,rgb in images.items()}
            result['panels'].append(save_set(tag,'marked-shadow',section,photo.setup['mark_ev'],selected,gain,order))
        for mark in marks:
            x, y = (pos-origin for pos,origin in zip(mark['coords'],rect[:2]))
            scores = {name:first.canon_ladder.site_scores(field,x,y) for name,field in axes.items()}
            for name in ('developed','clean'):
                np.testing.assert_allclose(list(scores[name].values()),list(mark['scores'][name].values()),
                                           atol=1e-7,rtol=1e-5)
            rows.append(dict(coords=mark['coords'],mark=mark['mark'],scores=scores))
    if rows:
        modes = ['developed','clean','round3',*methods]
        if tag == 'canon':
            modes.append('dxo_standard')
        result['marks'] = dict(rows=rows, counts={
            mode:prior.visibility(rows,mode,'round3') for mode in modes}, material={
            mode:dxo.mark_summary(rows,mode,'round3') for mode in ['clean',*methods]})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('tag', choices=tuple(first.NAMES))
    parser.add_argument('mode', choices=('screen','candidates','sweep','final'))
    parser.add_argument('--lead', choices=tuple(METHODS), default='gated')
    parser.add_argument('--strength', type=float, default=1.)
    parser.add_argument('--methods', nargs='+', choices=tuple(METHODS))
    args = parser.parse_args()
    if args.mode == 'sweep':
        methods = {f'{strength:g}':(METHODS[args.lead],strength) for strength in SWEEP}
        result = evaluate(args.tag,methods,sweep=True)
    elif args.mode == 'final':
        methods = {'round4':(METHODS[args.lead],args.strength)}
        result = evaluate(args.tag,methods,choose='round4')
    else:
        methods = {name:(METHODS[name],1.) for name in (args.methods or METHODS)}
        result = screen(args.tag,methods) if args.mode == 'screen' else evaluate(args.tag,methods)
    second.write(HERE/f'{args.tag}-{args.mode}.json', result)
    dxo.peak_memory()
