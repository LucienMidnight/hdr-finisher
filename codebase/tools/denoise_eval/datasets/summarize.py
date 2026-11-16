"""Summarise pair results with equal capture then scene weights within each band."""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
from statistics import mean


def iso_band(iso):
    return 'low: <=3200' if iso <= 3200 else 'mid: 3201..12800' if iso <= 12800 else 'high: >12800'


def flatten(value, prefix=''):
    if isinstance(value, dict):
        return {name: number for key, child in value.items()
                for name, number in flatten(child, f'{prefix}.{key}' if prefix else key).items()}
    if isinstance(value, list):
        return {name: number for index, child in enumerate(value)
                for name, number in flatten(child, f'{prefix}.{index}').items()}
    if isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value):
        return {prefix: value}
    return {}


def summarize(results):
    groups = defaultdict(list)
    for case in results['cases']:
        metadata = case['metadata']
        split = 'held-out' if metadata['held_out'] else 'seen by RawNIND'
        band = iso_band(metadata['iso'])
        for adapter, measured in case['adapters'].items():
            if 'error' in measured or 'skipped' in measured:
                raise ValueError(f'Incomplete pair measurement: {case["name"]} / {adapter}')
            for population in ('all', split):
                for interval in ('all ISOs', band):
                    groups[population, interval, adapter].append((metadata, flatten(measured)))
    rows = []
    for (population, band, adapter), cases in sorted(groups.items()):
        fields = sorted({field for metadata, values in cases for field in values
                         if not field.startswith('adapter_state.')})
        metrics = {}
        for field in fields:
            captures = defaultdict(list)
            for metadata, values in cases:
                if field in values:
                    captures[metadata['scene_id'], metadata['source']].append(values[field])
            scenes = defaultdict(list)
            for (scene, capture), values in captures.items():
                scenes[scene].append(mean(values))
            metrics[field] = dict(mean=mean(mean(values) for values in scenes.values()),
                                  scenes=len(scenes), captures=len(captures),
                                  crops=sum(len(values) for values in captures.values()))
        rows.append(dict(population=population, iso_band=band, adapter=adapter,
                         scenes=len({metadata['scene_id'] for metadata, values in cases}),
                         captures=len({metadata['source'] for metadata, values in cases}), crops=len(cases), metrics=metrics))
    return dict(weighting='Arithmetic crop mean within capture; capture mean within scene/band; equal scene mean. '
                          'Colour p99 is a mean of crop p99s, not a pooled pixel percentile. '
                          'Missing metric values are omitted with explicit support counts; null PSNR means infinity.',
                rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text(json.dumps(summarize(json.loads(args.results.read_text())), indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
