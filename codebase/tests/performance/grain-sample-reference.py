"""Bounded real-photo inputs and perceptual/texture analysis for the grain sweep."""
import argparse
from dataclasses import asdict
import gc
import json
from pathlib import Path
import struct
import subprocess
import zlib

import cv2
import numpy as np
from PIL import Image

from hdr_finisher.color import acescg_to_linear_srgb, linear_srgb_to_acescg
from hdr_finisher.binaries import resolve_binary
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.loader import load_image


def prepare(folder, sources):
    folder.mkdir(parents=True, exist_ok=True)
    cases = []
    for source in sources:
        source = Path(source).resolve()
        image, descriptor, metadata, retained, reference = load_image(source, analyze_hdr=False)
        native_height, native_width = image.shape[:2]
        for label, scale in [('fit1024', 1024 / max(native_width, native_height)),
                             ('fit4096', 4096 / max(native_width, native_height)),
                             ('zoom50', .5), ('zoom100', 1.)]:
            scale = min(scale, 1.)
            width, height = round(native_width * scale), round(native_height * scale)
            if label.startswith('zoom'):
                crop_size = min(1024, width, height)
                native_size = round(crop_size / scale)
                left, top = (native_width - native_size) // 2, (native_height - native_size) // 2
                patch = image[top:top + native_size, left:left + native_size]
                plane = cv2.resize(patch, (crop_size, crop_size), interpolation=cv2.INTER_AREA)
                origin = [round(left * scale), round(top * scale)]
            else:
                plane = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
                origin = [0, 0]
            for lane in ['hdr', 'sdr']:
                linear_srgb = np.maximum(acescg_to_linear_srgb(plane), 0)
                base = linear_srgb / (1 + linear_srgb)
                if lane == 'hdr':
                    base = linear_srgb_to_acescg(base * 2)
                rgba = np.concatenate([base, np.ones((*base.shape[:2], 1), np.float32)], axis=-1)
                filename = f'{source.stem}-{label}-{lane}.input'
                rgba.astype('<f2').tofile(folder / filename)
                cases.append(dict(photo=source.name, source=str(source), label=label, lane=lane,
                                  scale=scale, frame=[width, height], origin=origin,
                                  width=rgba.shape[1], height=rgba.shape[0], file=filename))
            del plane, rgba, linear_srgb, base
        del image, descriptor, metadata, retained, reference
        gc.collect()
    (folder / 'inputs.json').write_text(json.dumps(cases, indent=2))


def radial_power(noise):
    height, width = noise.shape[:2]
    window = np.outer(np.hanning(height), np.hanning(width))
    frequencies = np.sqrt(np.fft.fftfreq(height)[:, None] ** 2 + np.fft.fftfreq(width)[None, :] ** 2)
    bins = np.minimum((frequencies * 64).astype(int), 31)
    power = np.abs(np.fft.fft2((noise - noise.mean(axis=(0, 1))) * window[..., None], axes=(0, 1))) ** 2
    return np.stack([np.bincount(bins.ravel(), channel.ravel(), minlength=32) /
                     np.maximum(np.bincount(bins.ravel(), minlength=32), 1)
                     for channel in np.moveaxis(power, -1, 0)], axis=-1)


def encode_png(image, lane, target):
    linear = np.maximum(acescg_to_linear_srgb(image) / 2 if lane == 'hdr' else image, 0)
    encoded = np.where(linear <= .0031308, 12.92 * linear, 1.055 * linear ** (1 / 2.4) - .055)
    Image.fromarray(np.round(np.clip(encoded, 0, 1) * 255).astype(np.uint8)).save(target)


def analyze(folder):
    report = json.loads((folder / 'measurements.json').read_text())
    gains = {}
    for group in report['groups']:
        captures = group['captures']
        group['referenceSamples'] = 1 if group['scale'] >= 1 else min(4, int(np.ceil(1 / max(.05, group['scale'])))) ** 2
        read = lambda entry: np.fromfile(folder / entry['file'], '<f2').reshape(256, 256, 4)[..., :3].astype(np.float32)
        base, reference = read(captures[0]), read(captures[-1])
        reference_noise = reference - base
        rms_reference = np.sqrt(np.mean(reference_noise ** 2, axis=(0, 1)))
        spectrum_reference = radial_power(reference_noise)
        for capture in captures[1:]:
            capture['effectiveSamples'] = min(capture['samples'], group['referenceSamples'])
            image = read(capture)
            noise = image - base
            capture['blurredColour'] = asdict(compare_finished_pixels(
                cv2.GaussianBlur(image, (0, 0), .75), cv2.GaussianBlur(reference, (0, 0), .75), group['lane']))
            rms = np.sqrt(np.mean(noise ** 2, axis=(0, 1)))
            spectrum = radial_power(noise)
            capture['rms'] = rms.tolist()
            capture['rmsRatio'] = (rms / np.maximum(rms_reference, 1e-12)).tolist()
            capture['radialPower'] = spectrum.tolist()
            capture['powerRelativeL1'] = float(np.abs(spectrum[1:] - spectrum_reference[1:]).sum() /
                                               max(spectrum_reference[1:].sum(), 1e-12))
            capture['highFrequencyPowerRatio'] = float(spectrum[24:].sum() / max(spectrum_reference[24:].sum(), 1e-12))
        group['referenceRms'] = rms_reference.tolist()
        group['referenceRadialPower'] = spectrum_reference.tolist()
        single = read(captures[1])
        key = (group['label'], group['setting'], group['lane'])
        if key not in gains:
            gains[key] = float(np.sqrt(np.mean(reference_noise ** 2) / max(np.mean((single - base) ** 2), 1e-12)))
        gain = gains[key]
        matched = base + gain * (single - base)
        matched_noise = matched - base
        matched_spectrum = radial_power(matched_noise)
        group['varianceMatchedSingle'] = dict(gain=gain, calibrationPhoto=report['groups'][0]['photo'],
            heldOut=group['photo'] != report['groups'][0]['photo'],
            method='Post-grain linear blend against the grain-free base, calibrated on photo one; CPU prototype, GPU cost not measured.',
            blurredColour=asdict(compare_finished_pixels(cv2.GaussianBlur(matched, (0, 0), .75),
                cv2.GaussianBlur(reference, (0, 0), .75), group['lane'])),
            rmsRatio=(np.sqrt(np.mean(matched_noise ** 2, axis=(0, 1))) / np.maximum(rms_reference, 1e-12)).tolist(),
            powerRelativeL1=float(np.abs(matched_spectrum[1:] - spectrum_reference[1:]).sum() / max(spectrum_reference[1:].sum(), 1e-12)))
        if group['setting'] in ['default', 'strong']:
            chosen = [next(entry for entry in captures if entry['samples'] == count) for count in [16, 12, 8, 1]]
            panels = [read(entry) for entry in chosen]
            stem = f"{Path(group['photo']).stem}-{group['label']}-{group['setting']}-{group['lane']}"
            encode_png(np.concatenate(panels[:3], axis=1), group['lane'], folder / f'{stem}-16-12-8-sdr.png')
            encode_png(np.concatenate([panels[0], panels[3], matched], axis=1), group['lane'], folder / f'{stem}-16-1-matched1-sdr.png')
            group['review'] = f'{stem}-16-12-8-sdr.png'
            if group['lane'] == 'hdr':
                import colour
                from hdr_finisher.color import acescg_to_linear_bt2020
                from hdr_finisher.color_context import scene_linear_to_nits
                for entry, panel in zip(chosen, panels):
                    pq = colour.models.eotf_inverse_ST2084(np.maximum(scene_linear_to_nits(acescg_to_linear_bt2020(panel), 203), 0))
                    cv2.imwrite(str(folder / f'{stem}-{entry["samples"]}-pq.png'),
                                np.round(np.clip(pq[..., ::-1], 0, 1) * 65535).astype(np.uint16))
                    target = folder / f'{stem}-{entry["samples"]}-pq.png'
                    encoded = target.read_bytes()
                    payload = b'cICP' + bytes([9, 16, 0, 1])
                    chunk = struct.pack('>I', 4) + payload + struct.pack('>I', zlib.crc32(payload))
                    target.write_bytes(encoded[:33] + chunk + encoded[33:])
                    encoder = resolve_binary('avifenc')
                    if encoder:
                        subprocess.run([str(encoder), '--lossless', '--depth', '12', '--yuv', '444',
                            '--cicp', '9/16/0', '--range', 'full', '--jobs', '1', '--speed', '8',
                            str(target), str(target.with_suffix('.avif'))], check=True, capture_output=True)
    report['summary'] = []
    for label in ['fit1024', 'fit4096', 'zoom50', 'zoom100']:
        groups = [group for group in report['groups'] if group['label'] == label]
        for samples in [1, 2, 4, 6, 8, 12, 16]:
            entries = [(group['lane'], next(capture for capture in group['captures'] if capture['samples'] == samples)) for group in groups]
            report['summary'].append(dict(label=label, samples=samples,
                gpuMedianMs=float(np.median([time for lane, entry in entries for time in entry['timesMs']])),
                hdrMeanMax=max(entry['blurredColour']['mean'] for lane, entry in entries if lane == 'hdr'),
                hdrP999Max=max(entry['blurredColour']['p999'] for lane, entry in entries if lane == 'hdr'),
                sdrMeanMax=max(entry['blurredColour']['mean'] for lane, entry in entries if lane == 'sdr'),
                sdrP999Max=max(entry['blurredColour']['p999'] for lane, entry in entries if lane == 'sdr'),
                rmsRatioMin=min(min(entry['rmsRatio']) for lane, entry in entries),
                rmsRatioMax=max(max(entry['rmsRatio']) for lane, entry in entries),
                powerRelativeL1Max=max(entry['powerRelativeL1'] for lane, entry in entries)))
    (folder / 'results.json').write_text(json.dumps(report, indent=2))
    paths = ['SDR sheets: left=16, centre=12, right=8. Second sheets: 16, raw draft 1, variance-matched prototype 1.',
             'HDR PNG: 16-bit Rec.2020/PQ, cICP 9/16/0/full. HDR AVIF: 12-bit 4:4:4, same tags; extra 12-bit rounding.',
             'The HDR lane SDR sheets are normalized previews, not HDR renditions.', '']
    paths.extend(str(path.resolve()) for path in sorted(folder.glob('*.png')))
    paths.extend(str(path.resolve()) for path in sorted(folder.glob('*.avif')))
    (folder / 'crop-paths.txt').write_text('\n'.join(paths) + '\n')
    for source in folder.glob('*.input'):
        source.unlink()
    for capture in folder.glob('*.rgba16'):
        capture.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'analyze'])
    parser.add_argument('--output', type=Path, default=Path('output/performance/grain-samples'))
    parser.add_argument('sources', nargs='*')
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.output, args.sources)
    else:
        analyze(args.output)
