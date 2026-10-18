"""One delivery policy, read by export, Proof and Library worker processes."""
import json
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, StrictBool
from .config import APP_DATA_DIR

PREFERENCES_PATH = APP_DATA_DIR / "delivery-preferences.json"
FORCE_CPU_ENV = "HDR_FINISHER_FORCE_CPU_DELIVERY"


def preferences(path=None):
    path = Path(path) if path is not None else PREFERENCES_PATH
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        forced = saved.get("force_cpu") is True
    except FileNotFoundError:
        forced = False
    # An explicit environment override always wins over the saved setting.
    environment = os.environ.get(FORCE_CPU_ENV, "").strip().lower() in {"1", "true", "yes", "on"}
    return {"force_cpu": forced, "environment_override": environment,
            "effective_force_cpu": forced or environment}


def save_preferences(force_cpu, path=None):
    path = Path(path) if path is not None else PREFERENCES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        try:
            handle.write(json.dumps({"force_cpu": force_cpu}).encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            handle.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return preferences(path)


def renderer_record():
    try:
        policy = preferences()
    except (OSError, ValueError, AttributeError):
        return {"renderer": "cpu", "fallback_reason": "CPU used because delivery settings could not be read."}
    if policy["environment_override"]:
        reason = f"CPU forced by {FORCE_CPU_ENV}."
    elif policy["force_cpu"]:
        reason = "CPU forced in Performance settings."
    else:
        reason = "GPU delivery is not implemented: the shared GPU graph lacks export resize and output sharpening."
    return {"renderer": "cpu", "fallback_reason": reason}


class DeliveryPreferences(BaseModel):
    force_cpu: StrictBool


def create_delivery_router():
    router = APIRouter(prefix="/api/delivery")

    @router.get("/preferences")
    def read():
        try:
            return preferences()
        except (OSError, ValueError, AttributeError) as error:
            raise HTTPException(500, "Delivery settings could not be read.") from error

    @router.post("/preferences")
    def update(value: DeliveryPreferences):
        try:
            return save_preferences(value.force_cpu)
        except OSError as error:
            raise HTTPException(500, "Delivery settings could not be saved.") from error

    return router
