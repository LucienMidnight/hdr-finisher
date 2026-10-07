from pathlib import Path

from frontend_source import frontend_declaration, frontend_scripts


FRONTEND = Path(__file__).resolve().parents[1] / "frontend"


def test_preview_resolution_contract_has_a_non_numeric_full_sentinel() -> None:
    javascript = frontend_scripts()

    assert '@typedef {"1024"|"2048"|"4096"|"full"} PreviewResolution' in javascript
    assert 'new Set(["1024", "2048", "4096", "full"])' in javascript
    assert 'if (normalized === "full") return Math.max(256, sourceEdge || 256);' in javascript


def test_full_is_diagnostic_only_and_cpu_full_requests_bounded_strips() -> None:
    """The old tier selector is confined to Settings diagnostics."""
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    preview_selector = html.split('id="preview-popover"', 1)[1].split("</div>", 1)[0]
    settings_selector = html.split('id="settings-preview-resolution"', 1)[1].split("</select>", 1)[0]
    assert '<option value="full">Full</option>' not in preview_selector
    assert '<option value="full">Full</option>' in settings_selector
    # Full is last, below 4K, because the list reads smallest to largest.
    assert settings_selector.index('value="4096"') < settings_selector.index('value="full"')


def test_render_plan_admission_never_expresses_an_unavailable_tier() -> None:
    plan = frontend_declaration("buildRenderPlan")

    # A diagnostic override may force Tiled, which is always safe, and may force
    # Direct only where admission would have allowed it anyway -- so it can make
    # admission more conservative but never less. A switch in the settings panel
    # has no business overriding the memory guard.
    assert 'options.executionOverride === "direct" && violations.length === 0 ? "direct"' in plan
    # Read the decision's mode expression and check every literal it can yield.
    decision = plan[plan.index("decision: {"):]
    expression = decision[decision.index("mode:"):decision.index("overridden:")]
    yielded = {token for token in expression.split('"')[1::2]}
    assert yielded <= {"tiled", "direct"}, yielded


def test_backend_preflight_reports_host_constraints_without_deciding_gpu_viability() -> None:
    backend = (FRONTEND.parent / "backend" / "hdr_finisher" / "resource_preflight.py").read_text(encoding="utf-8")
    estimate = backend[backend.index("def estimate_preview_resources(") : backend.index("def estimate_resources(")]

    assert "decides_gpu_viability" in backend
    assert "advisories.append(" in estimate
    # The megapixel guideline and the unmeasurable-memory case advise; only the
    # hard request bound and measured host memory can refuse.
    guarded = estimate[estimate.index("reason = \"\"") : estimate.index("if pixels > FULL_PREVIEW_MAX_PIXELS:")]
    assert "FULL_PREVIEW_MAX_DIMENSION" in guarded
    assert "safely_available is not None and estimated > safely_available" in guarded
    assert "FULL_PREVIEW_MAX_PIXELS" not in guarded
