#!/usr/bin/env python3
"""Extract only selected Python language JARs into the ignored artifacts directory."""
import zipfile
from pathlib import Path

base = Path(__file__).resolve().parent
archive = base / "python-ce-263.7031.23.zip"
out = base / "artifacts"
out.mkdir(exist_ok=True)
targets = (
    "python-ce/lib/modules/intellij.python.parser.jar",
    "python-ce/lib/modules/intellij.python.ast.jar",
    "python-ce/lib/modules/intellij.python.syntax.core.jar",
    "python-ce/lib/modules/intellij.python.syntax.jar",
)
with zipfile.ZipFile(archive) as z:
    available = set(z.namelist())
    for target in targets:
        if target not in available:
            raise SystemExit(f"Missing expected module: {target}")
        destination = out / Path(target).name
        destination.write_bytes(z.read(target))
        print(f"Extracted {destination.name}: {destination.stat().st_size:,} bytes")
