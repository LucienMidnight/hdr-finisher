"""Read-only compare commands and personal Library viewing preferences."""
import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from fastapi import HTTPException
from .library_kept import atomic_json

class ReviewPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compare_layout: Literal["side", "top", "split"] = "side"
    compare_names: bool = True
    focus_strength: float = Field(default=.65,ge=0,le=1)
    focus_sensitivity: float = Field(default=.5,ge=0,le=1)
    focus_color: str = Field(default="#47ff80",pattern=r"^#[0-9a-fA-F]{6}$")
    exposure_strength: float = Field(default=.65,ge=0,le=1)
    exposure_highlights: bool = True
    exposure_shadows: bool = True
    exposure_highlight_color: str = Field(default="#ff4050",pattern=r"^#[0-9a-fA-F]{6}$")
    exposure_shadow_color: str = Field(default="#4080ff",pattern=r"^#[0-9a-fA-F]{6}$")

class CompareRequest(BaseModel):
    action: Literal["on", "off", "left", "right", "move"]
    paths: list[str]
    selected: str
    left: str | None = None
    step: Literal[-1, 1] = 1


def compare(request):
    paths = list(dict.fromkeys(request.paths))
    if request.selected not in paths: raise ValueError("Select a photo to compare.")
    right = request.selected
    left = request.left or right
    if request.action in {"on", "left"}:
        if request.action == "left" or not request.left: left = right
        if left == right:
            i = paths.index(right)
            right = paths[min(i+1, len(paths)-1)] if i+1 < len(paths) else paths[max(0,i-1)]
    elif request.action == "move":
        i = paths.index(right)
        for candidate in range(i+request.step, len(paths) if request.step > 0 else -1, request.step):
            if paths[candidate] != left:
                right = paths[candidate]; break
    return {"enabled":request.action != "off", "left":left, "right":right}


def add_review_routes(router, index, marks):
    def preferences(change=None):
        with index._state:
            try: saved=json.loads(index.preferences_path.read_text(encoding="utf-8"))
            except FileNotFoundError: saved={}
            if not isinstance(saved,dict): raise ValueError("Library viewing settings could not be read; nothing was changed.")
            value=ReviewPreferences.model_validate(saved.get("review",{}) | (change or {}))
            if change is not None:
                saved["review"]=value.model_dump()
                atomic_json(index.preferences_path,saved)
            return value.model_dump()
    @router.get("/review-preferences")
    def read_preferences():
        try: return preferences()
        except (ValueError,OSError) as e: raise HTTPException(400,str(e)) from e
    @router.post("/review-preferences")
    def save_preferences(change:dict):
        try: return preferences(change)
        except (ValueError,OSError) as e: raise HTTPException(400,str(e)) from e
    @router.post("/compare")
    def command(request:CompareRequest):
        try:
            for path in [request.selected,request.left]:
                if path: marks._path(path)
            return compare(request)
        except (ValueError,OSError) as e: raise HTTPException(400,str(e)) from e
