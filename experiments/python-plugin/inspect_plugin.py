#!/usr/bin/env python3
"""Inspect the bundled JetBrains Python Community Edition plugin archive.

Uses only Python's standard library. Reads the archive and nested descriptor in
memory; it does not unpack the 76 MB distribution or execute plugin code.
"""

from __future__ import annotations

import argparse
import io
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "archive",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent / "python-ce-263.7031.23.zip",
        help="Path to the Python Community Edition plugin ZIP",
    )
    args = parser.parse_args()

    with zipfile.ZipFile(args.archive) as distribution:
        names = distribution.namelist()
        main_jar_path = "python-ce/lib/python-ce.jar"
        if main_jar_path not in names:
            raise SystemExit(f"Missing expected nested plugin JAR: {main_jar_path}")

        module_jars = [
            name for name in names
            if name.startswith("python-ce/lib/modules/") and name.endswith(".jar")
        ]
        helper_files = [
            name for name in names if name.startswith("python-ce/helpers/")
        ]
        main_jar_bytes = distribution.read(main_jar_path)

    with zipfile.ZipFile(io.BytesIO(main_jar_bytes)) as plugin_jar:
        descriptor_path = "META-INF/plugin.xml"
        if descriptor_path not in plugin_jar.namelist():
            raise SystemExit(f"Missing {descriptor_path} in {main_jar_path}")
        root = ET.fromstring(plugin_jar.read(descriptor_path))

    def child_text(tag: str, default: str = "(not specified)") -> str:
        node = root.find(tag)
        return node.text.strip() if node is not None and node.text else default

    print(f"Archive: {args.archive}")
    print(f"Plugin: {child_text('name')}")
    print(f"ID: {child_text('id')}")
    print(f"Version: {child_text('version')}")
    compatibility = root.find("idea-version")
    if compatibility is not None:
        print(
            "IDE build range: "
            f"{compatibility.get('since-build', '?')} .. "
            f"{compatibility.get('until-build', '?')}"
        )

    print(f"Bundled module JARs: {len(module_jars)}")
    print(f"Bundled helper files: {len(helper_files)}")

    dependencies = root.find("dependencies")
    if dependencies is not None:
        print("Top-level platform dependencies:")
        for dependency in dependencies:
            identifier = dependency.get("id") or dependency.get("name")
            if identifier:
                print(f"  - {dependency.tag}: {identifier}")

    content = root.find("content")
    modules = content.findall("module") if content is not None else []
    module_names = {module.get("name") for module in modules if module.get("name")}
    print(f"Declared plugin modules: {len(modules)}")
    print("Modules marked required at top level:")
    required_modules = []
    for module in modules:
        if module.get("loading") == "required":
            name = module.get("name", "(unnamed)")
            required_modules.append((name, module))
            print(f"  - {name}")

    print("\nDirect dependencies of required modules (from embedded module descriptors):")
    for name, module in required_modules:
        descriptor_text = (module.text or "").strip()
        if not descriptor_text.startswith("<idea-plugin"):
            print(f"  {name}: no embedded module descriptor")
            continue
        try:
            module_descriptor = ET.fromstring(descriptor_text)
        except ET.ParseError as error:
            print(f"  {name}: could not parse embedded descriptor: {error}")
            continue
        module_dependencies = module_descriptor.find("dependencies")
        dependencies = []
        if module_dependencies is not None:
            for dependency in module_dependencies:
                identifier = dependency.get("id") or dependency.get("name")
                if identifier:
                    internal = (
                        dependency.tag == "module" and identifier in module_names
                    )
                    label = "plugin" if dependency.tag == "plugin" else "module"
                    if internal:
                        label += ", same plugin"
                    dependencies.append(f"{label}: {identifier}")
        print(f"  {name}:")
        if dependencies:
            for dependency in dependencies:
                print(f"    - {dependency}")
        else:
            print("    - (no direct dependencies declared)")

    print(
        "\nThis is metadata inspection only. It does not prove that plugin classes "
        "can run in a browser or that their IntelliJ Platform dependencies are "
        "available in WebBrains."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
