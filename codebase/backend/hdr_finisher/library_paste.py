"""Saved-grade clipboard, explicit pasteable fields, and bulk grade transactions."""
from copy import deepcopy
import json
from pathlib import Path
from threading import Lock, Event
from uuid import uuid4
from .library_scheduler import scheduler

# Backend-wide lane, shared by both windows and every LibraryPaste instance.
_PREPARATION_LANE = Lock()
from .models import EditDocument
from .projects import validate_saved
from .library_grades import grade_key
from .library_documents import atomic_json
from .raw_import import RAW_EXTENSIONS


def value(document, path):
    for part in path.split('.'):
        document = document[part]
    return document


def put(document, path, data):
    parts = path.split('.')
    for part in parts[:-1]: document = document[part]
    document[parts[-1]] = deepcopy(data)


def leaves(data, prefix):
    if isinstance(data, dict):
        return [p for key, item in data.items() for p in leaves(item, prefix+'.'+key)]
    return [prefix]


def setting_label(path):
    parts=path.split('.')
    if parts[0]=='global_adjustments':
        parts=parts[2:]
        if len(parts)>1 and parts[0] in ('film_look','color_grading','black_and_white','detail','vignette','geometry'): parts=parts[1:]
    elif parts[0]=='denoise': parts=parts[2:]
    elif parts[:2]==['source','raw_import_settings']: parts=parts[2:]
    if len(parts)>1 and parts[0] in ('controls','lens'): parts=parts[1:]
    return ' · '.join(SETTING_LABELS[part] for part in parts)


SETTING_LABELS = {
    'pixel_cleanup':'Pixel cleanup', 'remove_hot_pixels':'Remove hot pixels',
    'even_out_specks':'Even out harsh specks', 'speck_threshold':'Speck threshold',
    'enabled':'Enabled', 'tone_section_enabled':'Tone enabled',
    'highlight_section_enabled':'Highlight compression enabled',
    'tone_equalizer_section_enabled':'Exposure bands enabled',
    'color_section_enabled':'Colour enabled', 'hsl_section_enabled':'HSL enabled',
    'curves_section_enabled':'Curves enabled', 'detail_section_enabled':'Detail enabled',
    'black_and_white_section_enabled':'Black & white enabled',
    'film_look_section_enabled':'Film look enabled',
    'color_grading_section_enabled':'Colour grading enabled', 'vignette_section_enabled':'Vignette enabled',
    'hsl':'HSL', 'channels':'Colour channels', 'exposure':'Exposure', 'contrast':'Contrast',
    'contrast_pivot':'Contrast pivot', 'blacks':'Blacks', 'whites':'Whites', 'shadows':'Shadows',
    'midtones':'Midtones', 'highlights':'Highlights', 'shadows_center':'Shadows centre',
    'shadows_width':'Shadows width', 'midtones_center':'Midtones centre',
    'midtones_width':'Midtones width', 'highlights_center':'Highlights centre', 'highlights_width':'Highlights width',
    'white_balance_kelvin':'Temperature', 'tint':'Tint', 'saturation':'Saturation', 'vibrance':'Vibrance',
    'highlight_desaturation':'Highlight desaturation', 'highlight_desaturation_start':'Highlight desaturation start',
    'shadow_desaturation':'Shadow desaturation', 'shadow_desaturation_start':'Shadow desaturation start',
    'red_hue':'Red hue', 'red_purity':'Red purity', 'green_hue':'Green hue', 'green_purity':'Green purity',
    'blue_hue':'Blue hue', 'blue_purity':'Blue purity', 'tint_hue':'Tint hue', 'tint_purity':'Tint purity',
    'luma_curve':'Luminance curve', 'red_curve':'Red curve', 'green_curve':'Green curve', 'blue_curve':'Blue curve',
    'highlight_compression_start_nits':'Compression start (nits)',
    'highlight_compression_start_percent':'Compression start (%)',
    'highlight_compression_target_nits':'Target peak (nits)',
    'highlight_compression_manual_peak_nits':'Manual source peak (nits)',
    'highlight_compression_manual_peak_percent':'Manual source peak (%)',
    'highlight_compression_softness':'Softness', 'highlight_compression_mode':'Compression mode',
    'highlight_compression_peak_measurement':'Peak measurement', 'highlight_compression_peak_detail':'Peak detail',
    'highlight_compression_bias':'Compression bias', 'highlight_compression_color_handling':'Colour handling',
    'highlight_compression_attenuation':'Colour attenuation',
    'tone_equalizer_nodes':'Exposure bands', 'tone_equalizer_influence_radius':'Band influence',
    'tone_equalizer_smoothing':'Band smoothing',
    'look_strength':'Look strength', 'film_stock':'Film stock', 'stock_overrides':'Custom stock settings',
    'stock_color':'Stock colour', 'stock_tone':'Stock tone', 'stock_exposure':'Stock exposure',
    'stock_separation':'Colour separation', 'stock_print_warmth':'Print warmth', 'stock_print_tint':'Print tint',
    'stock_preflash':'Preflash', 'push_pull':'Push / pull', 'print_paper':'Print paper',
    'print_exposure':'Print exposure', 'shadow_contrast':'Shadow contrast', 'highlight_contrast':'Highlight contrast',
    'scan_sharpening':'Scan sharpening', 'lab_levels':'Lab levels', 'print_contrast':'Print contrast',
    'grain_enabled':'Grain enabled', 'grain_amount':'Grain amount', 'grain_size':'Grain size',
    'grain_softness':'Grain softness', 'grain_chroma':'Grain colour', 'grain_film_format':'Film format',
    'grain_capture_geometry':'Capture geometry', 'grain_film_type':'Film type',
    'grain_custom_width_mm':'Film width (mm)', 'grain_custom_height_mm':'Film height (mm)',
    'grain_shadow_response':'Grain in shadows', 'grain_midtone_response':'Grain in midtones',
    'grain_highlight_response':'Grain in highlights', 'grain_view_map':'Grain map',
    'film_resolution':'Film resolution', 'film_grain_seed':'Grain pattern',
    'halation_enabled':'Halation enabled', 'halation_amount':'Halation amount', 'halation_radius':'Halation radius',
    'halation_hue_offset':'Halation hue', 'halation_saturation':'Halation saturation', 'halation_view_map':'Halation map',
    'lens_filter':'Lens filter', 'lens_strength':'Filter strength', 'lens_size':'Filter size',
    'hue':'Hue', 'luminance_ev':'Luminance (EV)', 'blending':'Blending', 'balance':'Balance',
    'amount':'Amount', 'midpoint':'Midpoint', 'roundness':'Roundness', 'feather':'Feather',
    'highlight_protection':'Highlight protection', 'center_x':'Horizontal centre', 'center_y':'Vertical centre',
    'scale_x':'Horizontal scale', 'scale_y':'Vertical scale', 'texture_amount':'Texture',
    'clarity_amount':'Clarity', 'clarity_radius_percent':'Clarity radius (%)', 'sharpen_amount':'Sharpening',
    'sharpen_radius_px':'Sharpening radius (px)', 'sharpen_threshold':'Sharpening threshold',
    'softness':'Softness', 'microcontrast':'Microcontrast', 'use_authored_base':'Use authored SDR base',
    'reds':'Reds', 'oranges':'Oranges', 'yellows':'Yellows', 'greens':'Greens', 'aquas':'Aquas',
    'blues':'Blues', 'purples':'Purples', 'magentas':'Magentas',
    'white_balance':'White balance', 'demosaic':'Demosaicing', 'highlight_reconstruction':'Highlight reconstruction',
    'method':'Method', 'clipping_threshold':'Clipping threshold', 'edge_colour_expand_percent':'Edge colour expansion (%)',
    'mode':'Lens correction mode', 'distortion':'Distortion', 'chromatic_aberration':'Chromatic aberration',
    'vignetting':'Lens vignetting', 'rotation':'Rotation', 'flip_horizontal':'Flip horizontally',
    'flip_vertical':'Flip vertically', 'straighten_angle':'Straighten', 'perspective_horizontal':'Horizontal perspective',
    'perspective_vertical':'Vertical perspective', 'perspective_rotate':'Perspective rotation',
    'crop':'Crop', 'x':'Left', 'y':'Top', 'width':'Width', 'height':'Height',
    'ratio_mode':'Aspect ratio', 'custom_ratio':'Custom aspect ratio',
    'local_adjustments':'Local adjustments and masks', 'local_adjustments_enabled':'Local adjustments enabled',
    'luminance':'Luminance noise', 'color_noise':'Colour noise', 'detail_recovery':'Detail recovery',
    'finest_noise':'Finest noise', 'fine_noise':'Fine noise', 'medium_noise':'Medium noise', 'coarse_noise':'Coarse noise',
    'grain_evenness':'Grain Evenness', 'clean_splotches':'Clean color splotches', 'clean_fringes':'Clean edge fringes',
    'protect_color_edges':'Protect color edges',
    'color_splotches':'Color Splotches',
    'splotch_size':'Splotch Size',
    'micro_luminance':'Luminance', 'micro_color':'Color', 'micro_detail':'Detail',
}


def setting_group(field):
    if field.startswith('highlight_compression_') or field == 'highlight_section_enabled': return 'highlights'
    if field.startswith('tone_equalizer'): return 'equalizer'
    if field.endswith('_curve') or field == 'curves_section_enabled': return 'curves'
    for name in ('hsl','film_look','color_grading','vignette','detail','black_and_white'):
        if field == name or field == name+'_section_enabled': return name.replace('_','-')
    if field in ('exposure','contrast','contrast_pivot','blacks','whites','tone_section_enabled') or field.startswith(('shadows','midtones','highlights')): return 'tone'
    return 'color'


MODULE_ORDER = ('denoise','tone','highlights','equalizer','color','hsl','curves',
                'color-grading','black-and-white','detail','film-look','vignette')
LABELS = {'denoise':'Denoise','tone':'Tone','highlights':'Highlight compression',
    'equalizer':'Exposure bands','color':'Colour','hsl':'HSL','curves':'Curves',
    'color-grading':'Colour grading','black-and-white':'Black & white',
    'detail':'Detail','film-look':'Film look','vignette':'Vignette'}
SAFE_EXCLUSIONS = ('lens-corrections','geometry','perspective','local-adjustments')


class LibraryPaste:
    def __init__(self, grades):
        self.grades=grades; self.marks=grades.marks; self.clipboard=None
        self.preferences=self.marks.database.parent/'library-paste-selection.json'
        self._locks_lock=Lock(); self._path_locks={}
        self._operations = {}
        from .library_pictures import LibraryPictureCache
        self.pictures = LibraryPictureCache(self.marks.database.parent)

    def _path_lock(self, path):
        with self._locks_lock: return self._path_locks.setdefault(str(path),Lock())

    def document(self, path, *, stored_only=False, cancelled=lambda:False):
        state=self.grades._get(path)
        doc=self.marks._document(Path(path)) or {}
        current=state.get('desired') if state.get('pending') else doc.get('grade') or state.get('indexed_grade')
        default=state.get('default') or doc.get('grade_default')
        if default is None and stored_only and current is not None:
            default = current  # Preview only needs the authored current document.
        if default is None and stored_only:
            default = self.pictures.default_document(self.marks.source_path(path))
            if default is None: return None
        if default is None:
            # Concurrent preparation requests share one starting document.
            # Wait in short steps so a cancel or closed window is not stuck
            # behind another request preparing the same photo.
            lock=self._path_lock(path)
            while not lock.acquire(timeout=.05):
                if cancelled(): raise ValueError('Paste preparation cancelled; no grades changed.')
            try:
                default=self.grades._get(path).get('default') or self.starting_document(path, cancelled=cancelled)
                with self.marks._lock:
                    state=self.grades._get(path)
                    default=state.get('default') or default
                    state['default']=default; self.grades._put(path,state)
            finally:
                lock.release()
        from .projects import validate_saved
        return (validate_saved(EditDocument, current if current is not None else default).model_dump(mode="json"),
                validate_saved(EditDocument, default).model_dump(mode="json"))

    def starting_document(self, path, cancelled=lambda:False):
        source=self.marks.source_path(path)
        # Live scenes retain Grade's starting document for this photo version.
        try:
            document=self.pictures.default_document(source)
            if document: return validate_saved(EditDocument, document).model_dump(mode='json')
        except (OSError,ValueError): pass
        from .sessions import SessionStore
        from .library_diagnostics import log
        log("paste_cpu_fallback", path=str(source), reason="No retained starting document for this photo version.")
        from .library_estimates import full_import_estimate
        amount = full_import_estimate(source)
        while True:
            if cancelled(): raise ValueError('Paste preparation cancelled; no grades changed.')
            if not _PREPARATION_LANE.acquire(timeout=.05): continue
            token = uuid4().hex
            try:
                job = scheduler.ask(token, 'backend', str(source), 'paste-import', amount, 'soon')
                while job.granted is None:
                    if cancelled(): raise ValueError('Paste preparation cancelled; no grades changed.')
                    if job.reason == 'needs more memory':
                        raise ValueError(f'Preparing this photo needs about {amount/1e9:.1f} GB. Free memory or raise Memory the app may use in Settings.')
                    job.ready.wait(.05)
                preempted = Event()
                session = None
                def stopped():
                    with scheduler.lock:
                        grade = any(j.cls == 'Grade' for j in scheduler.jobs.values())
                    if grade: preempted.set()
                    return cancelled() or grade
                try:
                    if stopped(): raise RuntimeError('Import cancelled')
                    session = SessionStore().prepare_session(source, owns_source_path=False, cancelled=stopped)
                    if stopped(): raise RuntimeError('Import cancelled')
                    document = session.edit_document().model_dump(mode='json')
                    del session
                    return document
                except Exception:
                    if cancelled(): raise ValueError('Paste preparation cancelled; no grades changed.') from None
                    if not preempted.is_set(): raise
                    # Grade preemption is a safe-point pause, not a decoder retry.
            finally:
                session = None
                scheduler.finish(token)
                _PREPARATION_LANE.release()

    def begin(self):
        token = uuid4().hex
        with self._locks_lock: self._operations[token] = [Event(), False]
        return {'token':token}

    def cancel(self, token):
        with self._locks_lock:
            operation = self._operations.get(token)
            if operation and not operation[1]: operation[0].set()
        return {'cancelled':bool(operation and operation[0].is_set())}

    def prepare(self, path, token=None, cancelled=lambda:False):
        event = None
        if token:
            with self._locks_lock: event = self._operations[token][0]
        stop = lambda: cancelled() or bool(event and event.is_set())
        if stop(): raise ValueError('Paste preparation cancelled; no grades changed.')
        self.document(str(self.marks._path(path)), cancelled=stop)
        return {'ready':True}

    def schema(self, grade, start):
        groups={}
        def add(group,label,section,lane,paths):
            rows=[{'id':p,'label':setting_label(p),
                   'modified':value(grade,p)!=value(start,p)} for p in paths]
            groups[group]={'id':group,'label':label,'section':section,'lane':lane,'settings':rows,'modified':any(r['modified'] for r in rows)}
        for lane in ('hdr','sdr'):
            fields={}
            for field,data in grade['global_adjustments'][lane].items():
                if field in ('highlight_compression_source_peak_nits','highlight_compression_source_peak_percent',
                             'linked_to_hdr', 'output_exposure'): continue
                group=setting_group(field)
                fields.setdefault(group,[]).extend(leaves(data,'global_adjustments.'+lane+'.'+field))
            for group,paths in fields.items():
                if group=='film-look': paths=paths+['global_adjustments.shared.film_grain_seed']
                add(lane+'-'+group,LABELS[group],'Rendition settings',lane,paths)
            add(lane+'-denoise','Denoise','Rendition settings',lane,['denoise.'+lane+'.enabled']+leaves(grade['denoise'][lane]['controls'],'denoise.'+lane+'.controls'))
        raw=grade['source']['raw_import_settings']
        add('raw-development','RAW development','RAW development, lens and reconstruction',None,
            [p for key,data in raw.items() if key not in ('lens','highlight_reconstruction') for p in leaves(data,'source.raw_import_settings.'+key)])
        add('lens-corrections','Lens corrections','RAW development, lens and reconstruction',None,
            ['source.raw_import_settings.lens.'+key for key in ('mode','distortion','chromatic_aberration','vignetting')])
        add('highlight-reconstruction','Highlight reconstruction','RAW development, lens and reconstruction',None,
            leaves(raw['highlight_reconstruction'],'source.raw_import_settings.highlight_reconstruction'))
        geometry=leaves(grade['global_adjustments']['shared']['geometry'],'global_adjustments.shared.geometry')
        add('geometry','Crop & rotate','Crop & rotate / Perspective',None,[path for path in geometry if '.perspective_' not in path])
        add('perspective','Perspective','Crop & rotate / Perspective',None,[path for path in geometry if '.perspective_' in path])
        add('local-adjustments','Local adjustments and masks','Local adjustments and masks',None,['local_adjustments','global_adjustments.shared.local_adjustments_enabled'])
        return [group for group in groups.values() if not group['lane']] + [
            groups[lane+'-'+module] for module in MODULE_ORDER for lane in ('hdr','sdr')]

    def selection(self, groups, selection=None):
        allowed={r['id'] for g in groups for r in g['settings']}
        if selection is None:
            default={'lanes':['hdr','sdr'],'settings':[r['id'] for g in groups if g['id'] not in SAFE_EXCLUSIONS for r in g['settings']]}
            try: saved=json.loads(self.preferences.read_text(encoding='utf-8'))
            except (OSError,ValueError): return default
            # Preferences are optional; only explicit requests require strict IDs.
            if (not isinstance(saved,dict) or set(saved)!={'lanes','settings'}
                    or not all(isinstance(saved[key],list) and all(isinstance(item,str) for item in saved[key])
                               for key in ('lanes','settings'))):
                return default
            selection={'lanes':[lane for lane in saved['lanes'] if lane in ('hdr','sdr')],
                       'settings':[setting for setting in saved['settings'] if setting in allowed]}
        if not isinstance(selection,dict) or set(selection)-{'lanes','settings'}: raise ValueError('Choose the settings to paste.')
        lanes=selection.get('lanes',[]); settings=selection.get('settings',[])
        if not isinstance(lanes,list) or not isinstance(settings,list) or not all(isinstance(item,str) for item in lanes+settings) or set(lanes)-{'hdr','sdr'} or set(settings)-allowed:
            raise ValueError('Unknown paste setting.')
        return {'lanes':list(dict.fromkeys(lanes)),'settings':list(dict.fromkeys(settings))}

    def copy(self,path,cancelled=lambda:False):
        path=str(self.marks._path(path))
        self.document(path, cancelled=cancelled)
        with self.grades.store._lock,self.marks._lock:
            grade,start=self.document(path)
            self.clipboard={'path':path,'grade':grade,'start':start,'name':(self.marks._document(Path(path)) or {}).get('name') or self.marks.source_path(path).name}
        return self.describe()

    def describe(self):
        if self.clipboard is None: return {'name':None,'groups':[],'selection':None}
        clip=self.clipboard; groups=self.schema(clip['grade'],clip['start'])
        same_sides = all(value(clip['grade'], row['id']) == value(clip['grade'], row['id'].replace('.hdr.', '.sdr.'))
                         for group in groups if group['lane'] == 'hdr' for row in group['settings']
                         if '.hdr.' in row['id'])
        return {'name':clip['name'],'groups':groups,'selection':self.selection(groups),'same_sides':same_sides}

    def paste(self,paths,selection=None,preview=False,token=None):
        if not self.clipboard: raise ValueError('Copy a grade first.')
        clip=deepcopy(self.clipboard); groups=self.schema(clip['grade'],clip['start']); selection=self.selection(groups,selection)
        paths=list(dict.fromkeys(str(self.marks._path(p)) for p in paths))
        if not paths: raise ValueError('Select photos to paste onto.')
        # Cold starting documents may require a full corrected RAW decode. Do
        # that before the edit locks: Grade remains usable throughout preflight.
        if not preview:
            for path in paths: self.prepare(path, token)
            if token:
                with self._locks_lock:
                    event, applying = self._operations[token]
                    if event.is_set(): raise ValueError('Paste preparation cancelled; no grades changed.')
                    self._operations[token][1] = True
        targets={}; warnings=[]; unchecked=0
        raw_prefix='source.raw_import_settings.'
        with self.grades.store._lock,self.marks._lock:
            for path in paths:
                session=self.grades.history.current(path)
                if session and session.dirty and not preview: raise ValueError('Save or discard the open photo changes before pasting.')
                documents = self.document(path, stored_only=True) if preview else self.document(path)
                if documents is None:
                    unchecked += 1
                    continue
                current,start=documents; target=deepcopy(current)
                raw=self.marks.source_path(path).suffix.lower() in RAW_EXTENSIONS
                skipped=[]
                for group in groups:
                    if group['lane'] and group['lane'] not in selection['lanes']: continue
                    for row in group['settings']:
                        setting=row['id']
                        if setting not in selection['settings']: continue
                        if setting.startswith(raw_prefix) and not raw:
                            skipped.append(group['label']); continue
                        data=value(clip['grade'],setting)
                        put(target,setting,data)
                parsed = EditDocument.model_validate(target)
                if current['global_adjustments']['sdr'].get('linked_to_hdr', False):
                    from .models import SDRAdjustments, LocalGrade
                    from .sdr_link import linked_creative_changed
                    before_sdr = SDRAdjustments.model_validate(current['global_adjustments']['sdr'])
                    old_locals = {item['id']: item['sdr_grade'] for item in current['local_adjustments']}
                    local_edit = any(item.sdr_grade.model_dump() != old_locals.get(item.id, LocalGrade().model_dump())
                                     for item in parsed.local_adjustments)
                    if linked_creative_changed(before_sdr, parsed.global_adjustments.sdr) or local_edit:
                        target['global_adjustments']['sdr']['linked_to_hdr'] = False
                    elif target['denoise']['sdr'] != current['denoise']['sdr']:
                        target['global_adjustments']['sdr']['linked_to_hdr'] = False
                    else:
                        target['denoise']['sdr'] = deepcopy(target['denoise']['hdr'])
                if skipped: warnings.append({'path':path,'message':', '.join(dict.fromkeys(skipped))+' skipped for this file type.'})
                if not self.marks.source_path(path).parent.exists(): warnings.append({'path':path,'message':'Photo is offline; settings will be written when it reconnects.'})
                if grade_key(current)!=grade_key(target): targets[path]=target
            if preview: return {'count':len(targets),'unchecked':unchecked,'warnings':warnings}
            result=self.grades.history.rewrite(list(targets),targets=targets,save_open=True)
            atomic_json(self.preferences,selection)
            result['warnings']=warnings
            return result


def add_paste_routes(router,grades):
    from fastapi import HTTPException, Request
    import asyncio
    from starlette.concurrency import run_in_threadpool
    paste=LibraryPaste(grades); grades.paste=paste
    def call(action):
        try: return action()
        except (ValueError,OSError,KeyError) as error: raise HTTPException(status_code=400,detail=str(error)) from error
    @router.get('/grade-copy')
    def clipboard(): return call(paste.describe)
    async def until_done(connection, action):
        # Run blocking work; a closed window cancels it at the next safe point.
        # A disconnect must not free a reservation before the decoder stops.
        disconnected = Event()
        work = asyncio.create_task(run_in_threadpool(lambda:call(lambda:action(disconnected.is_set))))
        try:
            while not work.done():
                if await connection.is_disconnected(): disconnected.set()
                await asyncio.sleep(.05)
            return await work
        finally:
            disconnected.set()
            if not work.done():
                await asyncio.shield(work)
    @router.post('/grade-copy')
    async def copy_grade(request:dict, connection:Request):
        return await until_done(connection, lambda stop:paste.copy(request['path'], stop))
    @router.post('/grade-paste')
    def paste_grade(request:dict): return call(lambda:paste.paste(request.get('paths',[]),request.get('selection'),request.get('preview',False),request.get('token')))
    @router.post('/grade-preparation')
    def begin_preparation(): return paste.begin()
    @router.post('/grade-preparation-cancel')
    async def cancel_preparation(request:dict): return paste.cancel(request['token'])
    @router.post('/grade-preparation-end')
    def end_preparation(request:dict):
        with paste._locks_lock: paste._operations.pop(request['token'], None)
        return {'done':True}
    @router.post('/grade-prepare')
    async def prepare_grade(request:dict, connection:Request):
        try:
            return await until_done(connection, lambda stop:paste.prepare(request['path'], request.get('token'), stop))
        finally:
            if await connection.is_disconnected() and request.get('token'):
                with paste._locks_lock: paste._operations.pop(request['token'], None)
