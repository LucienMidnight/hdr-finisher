from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"


def test_preview_resolution_contract_has_a_non_numeric_full_sentinel() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert '@typedef {"1024"|"2048"|"4096"|"full"} PreviewResolution' in javascript
    assert 'new Set(["1024", "2048", "4096", "full"])' in javascript
    assert 'if (normalized === "full") return "Full";' in javascript
    assert 'if (normalized === "full") return Math.max(256, sourceEdge || 256);' in javascript

    target_body = javascript.split("function previewTargetLongEdge", 1)[1].split(
        "function previewResolutionDimensions", 1
    )[0]
    assert target_body.index('normalized === "full"') < target_body.index("Number(normalized)")


def test_preview_diagnostics_separate_requested_and_presented_identity() -> None:
    javascript = (FRONTEND / "app.js").read_text(encoding="utf-8")

    assert "requestedTier: normalizedPreviewResolution()" in javascript
    assert "presentedTier: state.acceptedPresentation?.tier || null" in javascript
    assert "presentedGeneration: state.acceptedPresentation?.generation ?? null" in javascript
    assert "currentGeneration: state.previewGeneration[state.currentView]" in javascript
    assert "previewDimensions: previewResolutionDimensions()" in javascript

