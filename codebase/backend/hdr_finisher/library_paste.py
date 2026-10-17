"""Saved-grade clipboard, explicit pasteable fields, and bulk grade transactions."""
from copy import deepcopy
import json
from pathlib import Path
from .models import EditDocument
from .library_grades import grade_key
from .library_kept import atomic_json
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


def raw_exposure_from_start(copied, copied_start, target_start):
    """Temporary RAW exposure delta; remove when starting exposure becomes zero."""
    return target_start + copied - copied_start


def setting_label(path):
    parts=path.split('.')
    if parts[0]=='global_adjustments':
        parts=parts[2:]
        if len(parts)>1 and parts[0] in ('film_look','color_grading','black_and_white','detail','vignette','geometry'): parts=parts[1:]
    elif parts[0]=='denoise': parts=parts[2:]
    elif parts[:2]==['source','raw_import_settings']: parts=parts[2:]
    if len(parts)>1 and parts[0] in ('controls','lens'): parts=parts[1:]
    return ' · '.join(part.replace('_',' ').capitalize() for part in parts)


def setting_group(field):
    if field.startswith('highlight_'): return 'highlights'
    if field.startswith('tone_equalizer'): return 'equalizer'
    if field.startswith(('lift', 'gamma', 'gain')) or field == 'primaries_section_enabled': return 'zones'
    if field.endswith('_curve') or field == 'curves_section_enabled': return 'curves'
    for name in ('film_look','color_grading','vignette','detail','black_and_white'):
        if field == name or field == name+'_section_enabled': return name.replace('_','-')
    if field in ('exposure','contrast','contrast_pivot','shadow','shadow_lift','tone_section_enabled'): return 'tone'
    return 'color'


SECTIONS = {'tone':'Tone','highlights':'Tone','equalizer':'Tone','zones':'Tone','curves':'Tone',
    'color':'Colour','color-grading':'Colour','black-and-white':'Colour',
    'film-look':'Look','vignette':'Look','detail':'Detail','denoise':'Detail'}
LABELS = {'color':'Colour','color-grading':'Colour grading','black-and-white':'Black and white',
    'film-look':'Film look','equalizer':'Exposure bands','zones':'Lift, gamma, gain'}


class LibraryPaste:
    def __init__(self, grades):
        self.grades=grades; self.marks=grades.marks; self.clipboard=None
        self.preferences=self.marks.database.parent/'library-paste-selection.json'

    def document(self, path):
        state=self.grades._get(path)
        doc=self.marks._document(Path(path)) or {}
        current=state.get('desired') if state.get('pending') else doc.get('grade') or state.get('indexed_grade')
        default=state.get('default') or doc.get('grade_default')
        if default is None:
            from .sessions import SessionStore
            session=SessionStore().prepare_session(self.marks.source_path(path),owns_source_path=False)
            default=session.edit_document().model_dump(mode='json')
            state['default']=default; self.grades._put(path,state)
        return deepcopy(current or default),deepcopy(default)

    def schema(self, grade, start):
        groups={}
        def add(group,label,section,lane,paths):
            rows=[{'id':p,'label':setting_label(p),
                   'modified':value(grade,p)!=value(start,p)} for p in paths]
            groups[group]={'id':group,'label':label,'section':section,'lane':lane,'settings':rows,'modified':any(r['modified'] for r in rows)}
        for lane in ('hdr','sdr'):
            fields={}
            for field,data in grade['global_adjustments'][lane].items():
                if field in ('highlight_compression_source_peak_nits','highlight_compression_source_peak_percent'): continue
                group=setting_group(field)
                fields.setdefault(group,[]).extend(leaves(data,'global_adjustments.'+lane+'.'+field))
            for group,paths in fields.items():
                if group=='film-look': paths=paths+['global_adjustments.shared.film_grain_seed']
                add(lane+'-'+group,LABELS.get(group,group.capitalize()),SECTIONS[group],lane,paths)
            add(lane+'-denoise','Denoise','Detail',lane,['denoise.'+lane+'.enabled']+leaves(grade['denoise'][lane]['controls'],'denoise.'+lane+'.controls'))
        raw=grade['source']['raw_import_settings']
        add('raw-development','RAW development','Outside the grade groups',None,
            [p for key,data in raw.items() if key!='lens' for p in leaves(data,'source.raw_import_settings.'+key)])
        add('lens-corrections','Lens corrections','Outside the grade groups',None,
            ['source.raw_import_settings.lens.'+key for key in ('mode','distortion','chromatic_aberration','vignetting')])
        add('geometry','Crop and geometry','Outside the grade groups',None,leaves(grade['global_adjustments']['shared']['geometry'],'global_adjustments.shared.geometry'))
        add('local-adjustments','Local adjustments and masks','Outside the grade groups',None,['local_adjustments','global_adjustments.shared.local_adjustments_enabled'])
        return list(groups.values())

    def selection(self, groups, selection=None):
        allowed={r['id'] for g in groups for r in g['settings']}
        if selection is None:
            try: selection=json.loads(self.preferences.read_text(encoding='utf-8'))
            except (OSError,ValueError): selection={'lanes':['hdr','sdr'],'settings':[r['id'] for g in groups if g['id'] not in ('lens-corrections','geometry','local-adjustments') for r in g['settings']]}
        if not isinstance(selection,dict) or set(selection)-{'lanes','settings'}: raise ValueError('Choose the settings to paste.')
        lanes=selection.get('lanes',[]); settings=selection.get('settings',[])
        if not isinstance(lanes,list) or not isinstance(settings,list) or set(lanes)-{'hdr','sdr'} or set(settings)-allowed:
            raise ValueError('Unknown paste setting.')
        return {'lanes':list(dict.fromkeys(lanes)),'settings':list(dict.fromkeys(settings))}

    def copy(self,path):
        path=str(self.marks._path(path))
        with self.grades.store._lock,self.marks._lock:
            grade,start=self.document(path)
            self.clipboard={'path':path,'grade':grade,'start':start,'name':(self.marks._document(Path(path)) or {}).get('name') or self.marks.source_path(path).name}
        return self.describe()

    def describe(self):
        if self.clipboard is None: return {'name':None,'groups':[],'selection':None}
        clip=self.clipboard; groups=self.schema(clip['grade'],clip['start'])
        return {'name':clip['name'],'groups':groups,'selection':self.selection(groups)}

    def paste(self,paths,selection=None,preview=False):
        if not self.clipboard: raise ValueError('Copy a grade first.')
        clip=deepcopy(self.clipboard); groups=self.schema(clip['grade'],clip['start']); selection=self.selection(groups,selection)
        paths=list(dict.fromkeys(str(self.marks._path(p)) for p in paths))
        if not paths: raise ValueError('Select photos to paste onto.')
        targets={}; warnings=[]
        raw_prefix='source.raw_import_settings.'
        with self.grades.store._lock,self.marks._lock:
            for path in paths:
                session=self.grades.history.current(path)
                if session and session.dirty and not preview: raise ValueError('Save or discard the open photo changes before pasting.')
                current,start=self.document(path); target=deepcopy(current)
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
                        if raw and setting in ('global_adjustments.hdr.exposure','global_adjustments.sdr.exposure'):
                            data=raw_exposure_from_start(data,value(clip['start'],setting),value(start,setting))
                        put(target,setting,data)
                EditDocument.model_validate(target)
                if skipped: warnings.append({'path':path,'message':', '.join(dict.fromkeys(skipped))+' skipped for this file type.'})
                if not self.marks.source_path(path).parent.exists(): warnings.append({'path':path,'message':'Photo is offline; settings will be written when it reconnects.'})
                if grade_key(current)!=grade_key(target): targets[path]=target
            if preview: return {'count':len(targets),'warnings':warnings}
            result=self.grades.history.rewrite(list(targets),targets=targets,save_open=True)
            atomic_json(self.preferences,selection)
            result['warnings']=warnings
            return result


def add_paste_routes(router,grades):
    from fastapi import HTTPException
    paste=LibraryPaste(grades); grades.paste=paste
    def call(action):
        try: return action()
        except (ValueError,OSError,KeyError) as error: raise HTTPException(status_code=400,detail=str(error)) from error
    @router.get('/grade-copy')
    def clipboard(): return call(paste.describe)
    @router.post('/grade-copy')
    def copy_grade(request:dict): return call(lambda:paste.copy(request['path']))
    @router.post('/grade-paste')
    def paste_grade(request:dict): return call(lambda:paste.paste(request.get('paths',[]),request.get('selection'),request.get('preview',False)))
    @router.get('/paste-pictures')
    def pictures(): return grades.marks.kept.queue_status()
    @router.post('/paste-pictures')
    def pictures_command(request:dict): return call(lambda:grades.marks.kept.queue_command(request))
