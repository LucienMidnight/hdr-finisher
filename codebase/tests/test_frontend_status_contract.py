from pathlib import Path

from frontend_source import frontend_scripts


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def test_status_manager_is_loaded_before_feature_code_and_dock_is_single_announcer() -> None:
    html = (FRONTEND / "index.html").read_text(encoding="utf-8")
    css = (FRONTEND / "styles.css").read_text(encoding="utf-8")

    assert 'id="viewer-status-dock" class="viewer-status-dock">' in html
    assert 'id="viewer-status-dock" class="viewer-status-dock" aria-live=' not in html
    assert 'id="application-status-entries"' in html
    assert 'class="viewer-status-row' not in html
    assert '.viewer-status-dock > .viewer-status-row' not in css
    assert html.index("status-manager.js") < html.index("application-shell.js") < html.index("app.js")


def test_project_badge_has_one_writer_and_attention_prompt_is_persistent() -> None:
    app = frontend_scripts()

    assert "persistent: true" in app
