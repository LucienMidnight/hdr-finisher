"""Compact machine-readable summary; no scoring or retuning here."""
import json
from pathlib import Path
from statistics import mean
from tools.denoise_eval.datasets.summarize import summarize, flatten

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT/'output/denoise-v1/speck-cleanup'


def main():
    report = {}
    for phase in ('quick', 'full', 'heldout', 'seen'):
        path=OUTPUT/phase/('results-pairs.json' if phase in ('heldout','seen') else 'results-'+phase+'.json')
        if not path.exists():
            continue
        results=json.loads(path.read_text())
        if results['adapter_errors']:
            raise ValueError('Cannot summarize incomplete evaluation')
        if phase in ('heldout','seen'):
            report[phase]=summarize(results)
            continue
        groups={}
        for iso in (1600,6400,25600):
            groups[str(iso)]={}
            cases=[c for c in results['cases'] if c['clean'] and c['metadata']['iso']==iso]
            for name in results['adapters']:
                rows=[flatten(c['adapters'][name]) for c in cases]
                fields={k for row in rows for k in row if not k.startswith('adapter_state.')}
                groups[str(iso)][name]={k:dict(mean=mean(r[k] for r in rows if k in r),cases=sum(k in r for r in rows)) for k in sorted(fields)}
        report[phase]=groups
        if phase=='full':
            report['real']=[dict(name=c['name'],metadata=c['metadata'],adapters=c['adapters']) for c in results['cases'] if not c['clean']]
    report['native']=[json.loads(p.read_text()) for p in sorted(OUTPUT.glob('native-*.json'))]
    (OUTPUT/'summary.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print('Summary written:', OUTPUT/'summary.json')


if __name__=='__main__':
    main()
