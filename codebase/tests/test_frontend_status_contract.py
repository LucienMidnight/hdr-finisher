from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_status_manager_is_loaded_before_feature_code_and_dock_is_single_announcer() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")

    assert 'id="viewer-status-dock" class="viewer-status-dock">' in html
    assert 'id="viewer-status-dock" class="viewer-status-dock" aria-live=' not in html
    assert 'id="application-status-entries"' in html
    assert html.index("status-manager.js") < html.index("application-shell.js") < html.index("app.js")


def test_required_failures_are_routed_and_open_save_alerts_are_removed() -> None:
    app = (FRONTEND / "app.js").read_text(encoding="utf-8")
    shell = (FRONTEND / "application-shell.js").read_text(encoding="utf-8")
    proof = (FRONTEND / "proofing-ui.js").read_text(encoding="utf-8")

    for channel in ("project-open", "project-save", "import", "edit", "match", "proof", "path-mask", "export"):
        assert f'id: "{channel}"' in app or f'id: "{channel}"' in proof
    assert 'id: "external-link"' in shell
    assert 'id: "external-link"' in proof
    assert "window.HDRDialogs.alert(" not in app
    assert "window.HDRDialogs.alert(" not in shell


def test_project_badge_has_one_writer_and_attention_prompt_is_persistent() -> None:
    app = (FRONTEND / "app.js").read_text(encoding="utf-8")
    badge_writer = app[app.index("function syncProjectBadge(") : app.index("function sourcePathForClipboard(")]
    outside_writer = app.replace(badge_writer, "")

    assert "els.badge.textContent" in badge_writer
    assert "els.badge.className" in badge_writer
    assert "els.badge.textContent" not in outside_writer
    assert "els.badge.className" not in outside_writer
    assert 'id: "source-interpretation"' in app
    assert 'severity: "attention"' in app
    assert "persistent: true" in app
    assert 'label: "Use assumption"' in app
    assert 'label: "Set manually"' in app
