"""Transient per-photo Retouch route records; never part of saved documents."""
from dataclasses import replace
import hashlib
import json
from concurrent.futures import CancelledError
from .retouch_recipe import prepare_repair, stroke_mask
from .retouch_methods import finish_repair
from .retouch_transfer import transfer_repair


def solve_record(session, record, worker, token, base, checkpoint):
    from . import retouch_gpu
    from .delivery import preferences
    try:
        force_cpu=preferences()['effective_force_cpu']
    except (OSError,ValueError,AttributeError):
        force_cpu=False
    recipe=record.recipe
    signature=recipe.model_dump_json()
    key='finished:'+hashlib.sha256(json.dumps([token.source,signature,force_cpu]).encode()).hexdigest()
    def solve(check):
        try:
            return retouch_gpu.solve(recipe,base,check,priority=getattr(session,'delivery_priority',0))
        except CancelledError:
            raise
        except (OSError,ValueError,RuntimeError) as error:
            reason=str(error)
        check()
        if recipe.mode!='inpaint':
            patch,_=transfer_repair(recipe,base,check)
        else:
            request=prepare_repair(recipe,lambda t,l,b,r:base[t:b,l:r],checkpoint=check)
            patch=worker.engine.solve(request,recipe.settings,check)
            patch=finish_repair(recipe,request,patch,stroke_mask(recipe,check),check)
        return replace(patch,renderer='cpu',fallback_reason=reason)
    patch=worker.completed_recipe(key,token,solve,checkpoint)
    checkpoint()
    if not hasattr(session,'_repair_routes'):session._repair_routes={}
    session._repair_routes[signature]={'renderer':patch.renderer,'fallback_reason':patch.fallback_reason}
    from .library_diagnostics import log
    log('retouch_route',path=str(getattr(session,'source_path','')),photo=getattr(getattr(session,'source',None),'filename','Photo'),
        repair=record.id,mode=recipe.mode,**session._repair_routes[signature])
    return patch


def records(session):
    session=getattr(session,'delivery_owner',session)
    known=getattr(session,'_repair_routes',{})
    return [dict(id=r.id,name=r.name,mode=r.recipe.mode,**known[r.recipe.model_dump_json()])
        for r in getattr(session,'repairs',[]) if r.enabled and r.recipe.model_dump_json() in known]


def notice(session):
    cpu=[r for r in records(session) if r['renderer']=='cpu']
    if not cpu:return None
    return 'Retouch CPU fallback: '+'; '.join(f"{r['name']} ({r['mode']}): {r['fallback_reason']}" for r in cpu)


def delivery_record(session, rendering):
    message=notice(session)
    if not message:return rendering
    from .library_diagnostics import log
    owner=getattr(session,'delivery_owner',session)
    log('retouch_delivery_fallback',path=str(getattr(owner,'source_path','')),reason=message)
    return dict(rendering,fallback_reason='; '.join(v for v in (rendering.get('fallback_reason'),message) if v))
