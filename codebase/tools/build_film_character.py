from pathlib import Path
import json, math
root=Path(__file__).resolve().parents[1]
data_dir=root/'backend/hdr_finisher/film_stocks'
# PGI-like placements are calibration coordinates, never measured PGI unless noted.
rows={
'kodak_portra_400':(37,'Confirmed','Kodak E-4050 (January 2025), 35mm 4x6 PGI 37'),
'kodak_portra_160':(28,'Confirmed','Kodak E-4051 (January 2025), 35mm 4x6 PGI 28'),
'kodak_portra_800':(48,'Confirmed','Kodak E-4040 (January 2025), 35mm 4x6 PGI 48'),
'kodak_ektar_100':(24,'Estimate','Kodak E-4046 says below 25; choose 24, not a measured PGI'),
'kodak_gold_200':(44,'Confirmed','Kodak E-7022 (June 2023), 35mm 4x6 PGI 44'),
'kodak_ultramax_400':(46,'Confirmed','Kodak E-7023 (February 2016), 35mm 4x6 PGI 46'),
'fujifilm_c200':(44,'Estimate','Near Gold 200 by speed; Fujifilm RMS 4 does not establish a PGI'),
'fujifilm_xtra_400':(46,'Estimate','Near Ultramax 400 by speed; Fujifilm RMS 4 does not establish a PGI'),
'fujifilm_pro_400h':(37,'Estimate','Near Portra 400 by speed and professional-negative positioning; RMS 4 cannot rank'),
'kodak_portra_800_push1':(52,'Estimate','One PGI-like noticeable step coarser than Portra 800; no pushed PGI'),
'kodak_portra_800_push2':(56,'Estimate','Two PGI-like noticeable steps coarser than Portra 800; no pushed PGI'),
'fujifilm_velvia_100':(24,'Estimate','RMS 8 reversal; place next to finest negative, not an RMS-to-PGI conversion'),
'fujifilm_provia_100f':(24,'Estimate','RMS 8 reversal; place next to finest negative, not an RMS-to-PGI conversion'),
'kodak_ektachrome_100':(24,'Estimate','E-4024 RMS 8 is a Proxy for older E100G/GX; use finest-negative placement'),
'kodak_kodachrome_64':(24,'Estimate','E-55 extremely fine grain and ISO 64; alongside other fine slides'),
'kodak_verita_200d':(34,'Estimate','ISO 200 daylight cine description; between Vision3 50D and 250D; sheet Missing'),
'kodak_vision3_50d':(24,'Estimate','5203 March 2022 p3 granularity curves; finest cine placement'),
'kodak_vision3_200t':(34,'Estimate','5213 brochure p2 granularity curves; near 250D, slightly finer'),
'kodak_vision3_250d':(36,'Estimate','5207 March 2022 p3 granularity curves; between 200T and 500T'),
'kodak_vision3_500t':(44,'Estimate','H-1-5219t July 2015 p4 granularity curves; coarsest cine placement'),
}
anchor=24.0
stocks={}
for stock,(pgi,status,source) in rows.items():
    manifest=json.loads((data_dir/f'{stock}.json').read_text())
    f=2**((pgi-37)/43) # half the log-scale change each to diameter and amplitude
    amount=anchor*f
    size=(13.2*f-6)/.24
    anti=manifest['antihalation']
    strengths={'strong':[.015,.005,0],'weak':[.08,.02,0],'no':[.30,.10,.015]}[anti]
    # Project onto the unchanged tint model. Strong/weak have exact R:G ratios;
    # the no-backing blue component needs a small desaturation (least-squares fit).
    if anti=='no': hue,sat=30.0,90.0
    else: hue=math.degrees(math.asin((strengths[1]/strengths[0]-.30)/.20))/.45; sat=100.
    sigma=65 if manifest['use']=='still' else 50
    defaults={'grain_amount':round(amount,6),'grain_size':round(size,6),
              'halation_amount':round(100*strengths[0]/.42,6),
              'halation_radius':round(100*(3*sigma/1000)/math.hypot(36,24),9),
              'halation_hue_offset':round(hue,6),'halation_saturation':sat,'print_paper':'default'}
    provenance={k:{'status':'Estimate','source':source+'; HDR Finisher PGI calibration'} for k in ['grain_amount','grain_size']}
    for k in ['halation_amount','halation_radius','halation_hue_offset','halation_saturation']:
        provenance[k]={'status':'Estimate','source':'Projection of spektrafilm 3bb2c2d params_builder.py _HALATION_PRESETS into unchanged HDR Finisher renderer'}
    provenance['print_paper']={'status':'Confirmed','source':f"spektrafilm profile target_print: {manifest['default_paper']}; slides bypass print"}
    stocks[stock]={'defaults':defaults,'provenance':provenance,'placement':{'value':pgi,'status':status,'source':source},
                   'halation':{'use':manifest['use'],'antihalation':anti,'tags_status':'Confirmed','sigma_um':sigma,'strength_rgb':strengths,'status':'Spektrafilm estimate','source':'spektrafilm 3bb2c2d runtime/params_builder.py _HALATION_PRESETS'},'default_paper':manifest['default_paper']}
stocks['none']={'defaults':{'grain_amount':0,'grain_size':50,'halation_amount':0,'halation_radius':.2,'halation_hue_offset':0,'halation_saturation':75,'print_paper':'default'},'provenance':{k:{'status':'Estimate','source':'Synthetic Neutral: no own grain or halation; inactive control baselines retained'} for k in stocks['kodak_portra_400']['defaults']}}
charts={
'kodak_vision3_50d':[[6,6,9],[4,4.5,7.5],[2.5,3.5,5]],
'kodak_vision3_200t':[[9,9,17],[6,7,15],[5,6,12]],
'kodak_vision3_250d':[[10,10,16],[5,7,13],[4.5,5.5,9]],
'kodak_vision3_500t':[[11,13,31],[6,8,19],[5,6,12]],
}
for k,v in charts.items(): stocks[k]['chart_reading']={'status':'Estimate','source':stocks[k]['placement']['source'],'log_relative_exposure':[1.5,3,4.5],'rms_rgb':v,'reading_uncertainty':'about +/-25%, visual log-axis readings, not digitized manufacturer numbers'}
data={'format':'hdr-finisher-film-character/1','portra_400_anchor_amount':anchor,'anchor_diameter_um':13.2,'pgi_per_doubling':21.5,'stocks':stocks}
(data_dir/'character.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
# Generated static bootstrap avoids asynchronous defaults or a second editable table.
(root/'frontend/film-character-data.js').write_text('// Generated by tools/build_film_character.py; edit the calibration there.\n(function(root) {\n  const data = '+json.dumps(data,separators=(',',':'))+';\n  if (typeof module !== "undefined") module.exports = data;\n  root.HDRFilmCharacterData = data;\n})(typeof window === "undefined" ? globalThis : window);\n',encoding='utf-8')
