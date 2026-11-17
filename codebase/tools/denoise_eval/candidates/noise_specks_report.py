"""Rebuild compact summaries from retained receipts, with no new measurements."""
import json
from pathlib import Path
from statistics import mean

from tools.denoise_eval.datasets.summarize import flatten, summarize

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT/'output/denoise-v1/noise-model-raw-specks'


def main():
    report = {}
    for phase in ('quick','full','heldout','seen'):
        name = 'pairs' if phase in ('heldout','seen') else phase
        results = json.loads((OUTPUT/phase/f'results-{name}.json').read_text())
        if results['adapter_errors']:
            raise ValueError(f'Incomplete {phase} run')
        if name=='pairs':
            report[phase] = summarize(results)
            continue
        groups = {}
        for iso in (1600,6400,25600):
            cases = [case for case in results['cases'] if case['clean'] and case['metadata']['iso']==iso]
            groups[str(iso)] = {}
            for adapter in results['adapters']:
                rows = [flatten(case['adapters'][adapter]) for case in cases]
                fields = {key for row in rows for key in row if not key.startswith('adapter_state.')}
                groups[str(iso)][adapter] = {key:dict(mean=mean(row[key] for row in rows if key in row),
                                                     cases=sum(key in row for row in rows)) for key in sorted(fields)}
        report[phase] = groups
        if phase=='full':
            report['real'] = [case for case in results['cases'] if not case['clean']]
            report['diagnostics'] = results['diagnostics']
    report['native'] = [json.loads(path.read_text()) for path in sorted(OUTPUT.glob('native-*.json'))]
    report['guards'] = {path.stem:json.loads(path.read_text()) for path in sorted(OUTPUT.glob('*-guard.json'))}
    decision = json.loads((ROOT/'output/denoise-v1/decision/manifest.json').read_text())
    report['decision'] = [dict(id=case['id'], columns=case['columns']) for case in decision['cases']]
    (OUTPUT/'summary.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(OUTPUT/'summary.json')


if __name__=='__main__':
    main()
