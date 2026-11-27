from __future__ import annotations

import ast
from pathlib import Path


CONTRACT_MODULES = {
    "test_frontend_controls_contract.py",
    "test_frontend_editor_layout_contract.py",
    "test_frontend_local_scope_contract.py",
    "test_frontend_presentation_contract.py",
    "test_frontend_render_pipeline_contract.py",
    "test_frontend_source_workflow_contract.py",
    "test_frontend_status_contract.py",
}


def test_frontend_contract_split_preserves_the_reviewed_inventory() -> None:
    tests_dir = Path(__file__).parent
    discovered = {
        path.name
        for path in tests_dir.glob("test_frontend_*_contract.py")
        if path.name != Path(__file__).name
    }
    assert discovered == CONTRACT_MODULES
    assert not (tests_dir / "test_frontend_contract.py").exists()

    test_names: list[str] = []
    for filename in sorted(CONTRACT_MODULES):
        tree = ast.parse((tests_dir / filename).read_text(encoding="utf-8"))
        test_names.extend(
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name.startswith("test_")
        )

    # 87 since October 7, 2026: checks that pinned only the wording of the
    # code were retired (Codebase Modularization Sprint, phase 1). What is left
    # pins page structure, styles, numbers, limits and shader maths.
    # Peak estimate opt-in was removed in favor of automatic measurement.
    # November 15, 2026: two tooltip source-wording checks were replaced by
    # real-app coverage of the shared tooltip controller (sprint item L1).
    # November 19: the Denoise setup source match is covered by the Electron
    # preparation, live blend, and recalculation checks.
    # November 27: shared Curves replaced the old drag source assertion with
    # live pointer, keyboard, and preview checks (aab6d698).
    assert len(test_names) == 82
    assert len(test_names) == len(set(test_names))
