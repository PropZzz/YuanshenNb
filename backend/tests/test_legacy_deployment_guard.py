from pathlib import Path
import subprocess
import sys


def test_single_file_deployer_rejects_modular_backend_before_ssh():
    root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, str(root / "deploy/deploy_schedule_constraints.py")],
        cwd=root, capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 2
    assert "full backend release" in result.stderr.lower()
    assert "SSH password" not in result.stdout
