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
    assert len(test_names) == 87
    assert len(test_names) == len(set(test_names))
