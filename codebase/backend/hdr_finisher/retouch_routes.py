"""Transient per-photo Retouch route records; never part of saved documents."""
from dataclasses import replace
import hashlib
import json
from concurrent.futures import CancelledError
from threading import RLock
from .retouch_recipe import prepare_repair, stroke_mask
from .retouch_methods import finish_repair
from .retouch_transfer import transfer_repair


# The document holds at most 256 repairs. Leave space for the active document
# and two full batches of recent results while edits are being published.
_ROUTE_RECORD_LIMIT = 3 * 256
_route_lock = RLock()


def _route_key(signature):
    return hashlib.sha256(signature.encode()).digest()


def _remember_route(session, signature, route):
    key = _route_key(signature)
    with _route_lock:
        routes = session.__dict__.setdefault('_repair_routes', {})
        routes.pop(key, None)
        if len(routes) >= _ROUTE_RECORD_LIMIT:
            active = {_route_key(r.recipe.model_dump_json()) for r in getattr(session, 'repairs', ())}
            # Active repairs may not be solved again on an unrelated edit.
            # Undo of an evicted, inactive recipe replays it and records its
            # route again. Drop a batch so we do not rescan active long strokes
            # for every newly solved recipe once at capacity.
            stale = [candidate for candidate in routes if candidate not in active]
            for candidate in stale[:max(1, _ROUTE_RECORD_LIMIT // 3)]:
                del routes[candidate]
        routes[key] = route


def solve_record(session, record, worker, token, base, checkpoint):
    from .highlight_edge_gpu import _work
    source_priority,source_cancelled=_work.get()
    outer_checkpoint=checkpoint
    def checkpoint():
        outer_checkpoint()
        if source_cancelled and source_cancelled():
            raise CancelledError('Source repair cancelled')
    recipe=record.recipe
    signature=recipe.model_dump_json()
    force_cpu = None
    if recipe.mode == 'inpaint':
        from .delivery import preferences
        try:
            force_cpu = preferences()['effective_force_cpu']
        except (OSError, ValueError, AttributeError):
            force_cpu = False
    key='finished:'+hashlib.sha256(json.dumps([token.source,signature,force_cpu]).encode()).hexdigest()
    def solve(check):
        if recipe.mode != 'inpaint':
            patch, _ = transfer_repair(recipe, base, check, replay=True)
            return replace(patch, renderer='cpu')
        from . import retouch_gpu
        try:
            return retouch_gpu.solve(recipe,base,check,priority=getattr(session,'delivery_priority',source_priority))
        except CancelledError:
            raise
        except (OSError,ValueError,RuntimeError) as error:
            reason=str(error)
        check()
        request=prepare_repair(recipe,lambda t,l,b,r:base[t:b,l:r],checkpoint=check)
        patch=worker.engine.solve(request,recipe.settings,check)
        patch=finish_repair(recipe,request,patch,stroke_mask(recipe,check),check)
        return replace(patch,renderer='cpu',fallback_reason=reason)
    patch=worker.completed_recipe(key,token,solve,checkpoint,bounded_replay=recipe.mode!='inpaint')
    checkpoint()
    route = {'renderer': patch.renderer, 'fallback_reason': patch.fallback_reason}
    _remember_route(session, signature, route)
    from .library_diagnostics import log
    log('retouch_route',path=str(getattr(session,'source_path','')),photo=getattr(getattr(session,'source',None),'filename','Photo'),
        repair=record.id,mode=recipe.mode,**route)
    return patch


def records(session):
    session=getattr(session,'delivery_owner',session)
    repairs = [(r, _route_key(r.recipe.model_dump_json())) for r in getattr(session, 'repairs', ()) if r.enabled]
    with _route_lock:
        known = getattr(session, '_repair_routes', {})
        return [dict(id=r.id, name=r.name, mode=r.recipe.mode, **known[key])
                for r, key in repairs if key in known]


def notice(session):
    cpu=[r for r in records(session) if r['fallback_reason']]
    if not cpu:return None
    return 'Retouch CPU fallback: '+'; '.join(f"{r['name']} ({r['mode']}): {r['fallback_reason']}" for r in cpu)


def delivery_record(session, rendering):
    message=notice(session)
    if not message:return rendering
    from .library_diagnostics import log
    owner=getattr(session,'delivery_owner',session)
    log('retouch_delivery_fallback',path=str(getattr(owner,'source_path','')),reason=message)
    return dict(rendering,fallback_reason='; '.join(v for v in (rendering.get('fallback_reason'),message) if v))
