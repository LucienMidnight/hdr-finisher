"""Create the local 1:1 comparison and an inline sweep chart."""
import argparse
from html import escape
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TAG_NAMES = {'canon':'Canon 7D · ISO 3200', 'sony':'Sony portrait · ISO 6400',
             'ordinary':'Sony holdout · ISO 10000', 'atrium':'Atrium · ISO 800'}
LABELS = {'developed':'Off', 'clean':'Clean Grain', 'round3':'Round 3', 'round4':'Round 4',
          'dxo_standard':'DxO Standard', '0.6':'60%', '1':'100%', '1.3':'130%'}
NAMES = {'dark-flat':'Dark background', 'dark-check':'Second dark patch', 'hair':'Hair',
         'face':'Face', 'lashes':'Face and eyelashes', 'skirt':'Skirt', 'skin':'Forehead',
         'flame':'Flame', 'marked-shadow':'Marked shadow', 'background':'Background', 'floor':'Floor', 'gray':'Grey background',
         'shirt':'Shirt', 'blue-pole-light':'Blue pole light', 'railing-lamp':'Railing lamp',
         'pole-neighbour':'Light beside pole'}
REVIEW_STYLE = '''
body { margin: 1rem; background: var(--app); color: var(--text);
       font: var(--font-weight-regular) var(--font-size-md)/var(--line-height-normal) var(--font-body); }
h1 { font: var(--font-weight-semibold) var(--page-title-font-size)/var(--line-height-tight) var(--font-body); }
h2 { font: var(--section-title-font); }
h3 { font: var(--subsection-title-font); }
a { color: var(--accent-strong); }
nav { display: flex; flex-wrap: wrap; gap: .5rem 1rem; }
section { margin: 1.5rem 0; }
p { margin: .4rem 0; }
.strip { display: flex; gap: .5rem; overflow-x: auto; padding-bottom: .5rem; }
figure { flex: none; margin: 0; }
figcaption, .crop-note { color: var(--body); font-size: var(--font-size-sm); }
img { display: block; max-width: none; }
table { border-collapse: collapse; text-align: right; }
th, td { padding: .25rem .6rem; border-bottom: 1px solid var(--border); }
th { font-weight: var(--font-weight-semibold); }
'''
CHART_STYLE = '''
.chart { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 236px), 1fr)); gap: 16px; }
.chart figure { min-width: 0; margin: 0; }
.chart figcaption { font-weight: var(--font-weight-semibold, 600); }
.chart canvas { width: 100%; height: 190px; display: block; }
'''
CHART_SCRIPT = '''
function draw(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w) return;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  const style = getComputedStyle(canvas);
  const color = (...keys) => {
    for (const key of keys) {
      const value = style.getPropertyValue(key).trim();
      if (value) return value;
    }
    return style.color;
  };
  const chart = JSON.parse(canvas.dataset.chart);
  const left = 47, right = w - 16, top = 17, bottom = h - 32;
  const x = i => left + chart.positions[i] * (right - left) / chart.positions.at(-1);
  const y = value => bottom - (value - chart.low) * (bottom - top) / (chart.high - chart.low);
  ctx.font = style.font;
  ctx.lineWidth = 1;
  for (const tick of chart.ticks) {
    ctx.strokeStyle = color('--border');
    ctx.beginPath();
    ctx.moveTo(left, y(tick));
    ctx.lineTo(right, y(tick));
    ctx.stroke();
    ctx.fillStyle = color('--muted-foreground', '--text', '--foreground');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(tick + chart.suffix, left - 7, y(tick));
  }
  ctx.fillStyle = color('--muted-foreground', '--text', '--foreground');
  ctx.textAlign = 'center';
  chart.labels.forEach((label, i) => {
    if (label !== '115%') ctx.fillText(label, x(i), bottom + 17);
  });
  if (chart.target >= chart.low && chart.target <= chart.high) {
    ctx.strokeStyle = color('--attention', '--warning');
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, y(chart.target));
    ctx.lineTo(right, y(chart.target));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const palette = [
    color('--chart-1', '--accent-strong'), color('--chart-2', '--scope-luma'),
    color('--chart-3', '--success')
  ];
  chart.series.forEach(([name, values], index) => {
    ctx.strokeStyle = palette[index];
    ctx.fillStyle = palette[index];
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((point, i) => (i ? ctx.lineTo(x(i),y(point)) : ctx.moveTo(x(i),y(point))));
    ctx.stroke();
    values.forEach((point, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(point), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  canvas.parentElement.querySelector('.legend').replaceChildren(...chart.series.map(([name], index) => {
    const label = document.createElement('span');
    label.textContent = (index ? ' · ' : '') + name;
    label.style.color = palette[index];
    return label;
  }));
}
for (const canvas of document.querySelectorAll('canvas')) {
  new ResizeObserver(() => draw(canvas)).observe(canvas);
  draw(canvas);
}
'''


def read(name):
    return json.loads((HERE/f'{name}.json').read_text())


def figure(panel, tag=None):
    x0,y0,x1,y1 = panel['rect']
    figures = ''.join(
        f'<figure><figcaption>{LABELS[name]}</figcaption>'
        f'<img src="{href}" alt="{LABELS[name]} · {NAMES[panel["key"]]}" '
        f'width="{x1-x0}" height="{y1-y0}" loading="lazy"></figure>'
        for name,href in panel['images'].items()
    )
    gain = f' · DxO display gain {panel["dxo_gain"]:.2f}×' if 'dxo_standard' in panel['images'] else ''
    anchor = f' id="{tag}-{panel["key"]}"' if tag else ''
    return (f'<h3{anchor}>{NAMES[panel["key"]]}</h3><p class="crop-note">'
            f'Sensor ({x0}, {y0}) · {x1-x0} × {y1-y0} px · {panel["ev"]:+g} EV{gain}</p>'
            f'<div class="strip" tabindex="0" aria-label="{NAMES[panel["key"]]} comparison">{figures}</div>')


def chart(sweep):
    keys = ['round3',*sweep['methods']]
    labels = ['R3',*[f'{100*float(key):.0f}%' for key in keys[1:]]]
    flats = {name:[round(100*sweep['flats'][key][mode]['y_rms_vs_off'],1) for mode in keys]
             for name,key in (('Dark background','dark'), ('Floor','mid'))}
    detail = {name.capitalize():[round(sweep['detail'][name]['shared']['3']['ratios'][mode],3) for mode in keys]
              for name in ('hair','face','skirt')}

    def graph(title, data, low, high, ticks, suffix, target):
        payload = dict(labels=labels, positions=[0.,*(float(key) for key in keys[1:])], series=list(data.items()), low=low, high=high, ticks=ticks,
                       suffix=suffix,target=target)
        return (f'<figure><figcaption>{title}</figcaption><canvas role="img" '
                f'aria-label="{title}. Values in the table below." data-chart="{escape(json.dumps(payload))}"></canvas>'
                '<p class="legend"></p></figure>')

    graphs = graph('Canon brightness noise · % of Off',flats,20,80,(20,40,60,80),'%',40)
    graphs += graph('Canon recognizable detail · 3 px',detail,.7,1.04,(.7,.85,1),'',.85)
    table = '<table><thead><tr><th>Strength</th><th>Dark</th><th>Floor</th><th>Hair</th><th>Face</th><th>Skirt</th></tr></thead><tbody>'
    for index,label in enumerate(labels):
        values = [f'{values[index]:.1f}%' for values in flats.values()]
        values += [f'{values[index]:.3f}' for values in detail.values()]
        table += '<tr><th scope="row">'+label+'</th>'+''.join(f'<td>{value}</td>' for value in values)+'</tr>'
    table += '</tbody></table>'
    return '<div class="chart">'+graphs+'</div>'+table


def emit(inline):
    sweep = read('canon-sweep')
    intro = ('<p>The dashed lines mark the 40% brightness-noise and .85 hair targets. '
             'R3 is round 3 before the added brightness filter.</p>')
    plots = chart(sweep)
    if inline:
        output = HERE/'sweep-chart.html'
        table_style = ('table { border-collapse: collapse; text-align: right; '
                       'font-variant-numeric: tabular-nums; } '
                       'th, td { padding: .22rem .45rem; border-bottom: 1px solid var(--border); }')
        html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
                f'<style>{CHART_STYLE}{table_style}</style></head>'
                f'<body>{intro}{plots}<script>{CHART_SCRIPT}</script></body></html>')
    else:
        output = HERE/'review.html'
        sections = []
        for tag,title in TAG_NAMES.items():
            result = read(f'{tag}-final')
            items = result['panels']
            if tag == 'atrium':
                items = items[:1]
            strip = ''.join(figure(item,tag) for item in items)
            sections.append(f'<section id="{tag}"><h2>{title}</h2>{strip}</section>')
        links = ''.join(f'<a href="#{tag}">{title}</a>' for tag,title in TAG_NAMES.items())
        sections.append('<section id="sweep"><h2>Luminance strength</h2>'+intro+plots+
                        ''.join(figure(item) for item in sweep['panels'])+'</section>')
        html = ('<!doctype html><html lang="en" data-theme="modern-dark"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width, initial-scale=1">'
                '<title>Pre-demosaic Denoise · Round 4</title>'
                '<link rel="stylesheet" href="../../frontend/visual-tokens.css">'
                f'<style>{REVIEW_STYLE}{CHART_STYLE}</style></head><body><main>'
                '<h1>Pre-demosaic Denoise · Round 4</h1>'
                '<p>Each crop is 1:1. Scroll sideways to see all columns. '
                'DxO Standard is available for the Canon only.</p>'
                f'<nav aria-label="Photos">{links}<a href="#sweep">Luminance strength</a></nav>'
                +''.join(sections)+f'</main><script>{CHART_SCRIPT}</script></body></html>')
    output.write_text(html)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inline-chart',action='store_true')
    emit(parser.parse_args().inline_chart)
