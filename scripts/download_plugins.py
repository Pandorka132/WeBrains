#!/usr/bin/env python3
"""Download pinned JetBrains Marketplace plugin distributions into raw-plugins/."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "experiments" / "plugin-build" / "plugins.json"
DEFAULT_OUTPUT = ROOT / "experiments" / "raw-plugins"
BUILDER = ROOT / "scripts" / "plugin_web_build.py"
MARKETPLACE_DOWNLOAD = "https://plugins.jetbrains.com/plugin/download"


def inspect_archive(path: Path) -> dict:
    spec = importlib.util.spec_from_file_location("plugin_web_build", BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load plugin build engine: {BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.inspect_plugin(path)["primaryPlugin"]


def download_one(plugin: dict, output: Path) -> Path:
    plugin_id = plugin["pluginXmlId"]
    version = plugin["version"]
    filename = plugin["filename"]
    if Path(filename).name != filename or not filename.lower().endswith(".zip"):
        raise ValueError(f"Unsafe plugin archive filename: {filename!r}")
    query = urllib.parse.urlencode({"pluginId": plugin_id, "version": version})
    url = f"{MARKETPLACE_DOWNLOAD}?{query}"
    destination = output / filename
    temporary = output / f".{filename}.download"
    request = urllib.request.Request(url, headers={"User-Agent": "WeBrains-plugin-builder/1.0"})
    print(f"Downloading {plugin_id} {version} from JetBrains Marketplace", flush=True)
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as stream:
            while chunk := response.read(1024 * 1024):
                stream.write(chunk)
        if not zipfile.is_zipfile(temporary):
            raise RuntimeError(f"Marketplace response is not a ZIP archive: {url}")
        with zipfile.ZipFile(temporary) as archive:
            bad_member = archive.testzip()
        if bad_member:
            raise RuntimeError(f"Downloaded plugin ZIP has a corrupt member: {bad_member}")
        descriptor = inspect_archive(temporary)
        if descriptor["id"] != plugin_id or descriptor["version"] != version:
            raise RuntimeError(
                "Downloaded plugin descriptor does not match the pinned manifest: "
                f"expected {plugin_id} {version}, got {descriptor['id']} {descriptor['version']}"
            )
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Verified {destination.name}: {plugin_id} {version}", flush=True)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    manifest_path = args.manifest if args.manifest.is_absolute() else ROOT / args.manifest
    output = args.output if args.output.is_absolute() else ROOT / args.output
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plugins = manifest.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        raise SystemExit("Plugin manifest must contain a non-empty 'plugins' array.")
    output.mkdir(parents=True, exist_ok=True)
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    for plugin in plugins:
        if not isinstance(plugin, dict) or not all(plugin.get(key) for key in ("pluginXmlId", "version", "filename")):
            raise SystemExit(f"Invalid plugin manifest entry: {plugin!r}")
        if plugin["pluginXmlId"] in seen_ids or plugin["filename"] in seen_names:
            raise SystemExit(f"Duplicate plugin ID or filename in manifest: {plugin!r}")
        seen_ids.add(plugin["pluginXmlId"])
        seen_names.add(plugin["filename"])
    for plugin in plugins:
        download_one(plugin, output)
    print(f"Downloaded and verified {len(plugins)} plugin archive(s) into {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"Plugin download failed: {error}", file=sys.stderr)
        raise SystemExit(1)
