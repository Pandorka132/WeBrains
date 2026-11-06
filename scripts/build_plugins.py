#!/usr/bin/env python3
"""Build configured browser capabilities from ZIPs in experiments/raw-plugins/.

Each input ZIP is one original JetBrains plugin distribution. The archive is
passed intact to the inspection/build engine; nested JARs are extracted only
into its temporary/cache build area, never into the raw input directory.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUT_ROOT = ROOT / "experiments" / "raw-plugins"
PROFILE_ROOT = ROOT / "experiments" / "plugin-build" / "profiles"
BUILDER = ROOT / "scripts" / "plugin_web_build.py"


def load_plugin_builder():
    import importlib.util

    spec = importlib.util.spec_from_file_location("plugin_web_build", BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load plugin build engine: {BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plugin_archives(input_root: Path) -> list[Path]:
    unexpected = [
        path.name for path in input_root.iterdir()
        if path.is_dir() or (path.is_file() and path.suffix.lower() != ".zip")
    ]
    if unexpected:
        raise RuntimeError(
            "raw-plugins must contain only plugin .zip files; "
            f"unexpected entries: {', '.join(sorted(unexpected))}"
        )
    archives = sorted(
        path for path in input_root.iterdir()
        if path.is_file() and path.suffix.lower() == ".zip"
    )
    if not archives:
        raise RuntimeError(f"No plugin .zip files found directly inside {input_root}")
    return archives


def profiles_for(plugin_id: str) -> list[Path]:
    matches = []
    for path in sorted(PROFILE_ROOT.glob("*.json")):
        profile = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(profile, dict) and profile.get("pluginId") == plugin_id and profile.get("batchEnabled", False):
            matches.append(path)
    return matches

def frontend_profiles(profiles: list[Path]) -> list[Path]:
    """Return only capabilities explicitly validated for use by the browser app."""
    return [
        path for path in profiles
        if json.loads(path.read_text(encoding="utf-8")).get("frontendEnabled", False)
    ]


def build_output_for(output_root: Path) -> Path:
    reports = list(output_root.glob("**/reports/plugin-inventory.json"))
    if len(reports) != 1:
        raise RuntimeError(f"Expected exactly one build report under {output_root}, found {len(reports)}")
    report = json.loads(reports[0].read_text(encoding="utf-8"))
    if report.get("status") != "BUILD_AND_RUNTIME_TEST_PASSED":
        raise RuntimeError(f"Build report is not successful: {reports[0]}")
    output = Path(report["outputDirectory"])
    if not output.is_dir():
        raise RuntimeError(f"Build output directory is missing: {output}")
    return output


def install_frontend_capabilities(
    profiles: list[Path], build_outputs: dict[Path, Path], plugin_id: str,
) -> None:
    """Copy only fully built and runtime-tested production capabilities to public assets."""
    import shutil

    destination = ROOT / "frontend" / "public" / "plugins" / safe_plugin_directory_name(plugin_id)
    destination.mkdir(parents=True, exist_ok=True)
    for profile_path in profiles:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        image_name = profile.get("imageName")
        if not image_name:
            raise RuntimeError(f"Frontend-enabled profile has no imageName: {profile_path}")
        assets = [f"{image_name}.js", f"{image_name}.js.wasm"]
        worker_name = profile.get("browserWorkerName")
        if profile.get("browserApi") and worker_name:
            assets.append(worker_name)
        web_directory = build_outputs[profile_path] / "web"
        for asset in assets:
            source = web_directory / asset
            if not source.is_file():
                raise RuntimeError(f"Validated build is missing frontend asset {asset}: {source}")
            shutil.copy2(source, destination / asset)


def safe_plugin_directory_name(plugin_id: str) -> str:
    import re

    normalized = plugin_id.lower()
    if not normalized or re.fullmatch(r"[a-z0-9][a-z0-9._-]*", normalized) is None:
        raise RuntimeError(f"Plugin ID cannot be used safely as an output directory: {plugin_id!r}")
    return normalized


def write_frontend_manifest(archive: Path, plugin: dict, profiles: list[Path], builder_module) -> Path:
    """Publish descriptor-derived metadata and successfully built capability assets."""
    import html
    import re
    import xml.etree.ElementTree as ET

    plugin_id = str(plugin["id"])
    plugin_directory_name = safe_plugin_directory_name(plugin_id)
    output_dir = ROOT / "frontend" / "public" / "plugins" / plugin_directory_name
    output_dir.mkdir(parents=True, exist_ok=True)

    # Extract nested JARs into a temporary directory only for descriptor/icon
    # metadata discovery. The original plugin ZIP remains untouched.
    description = ""
    vendor = ""
    icon_asset = None
    with tempfile.TemporaryDirectory(prefix="webrains-plugin-metadata-") as temporary:
        extracted_jars = builder_module.extract_plugin_jars(
            archive, Path(temporary) / "jars", ["**/*.jar", "*.jar"]
        )
        for jar_path in sorted(extracted_jars):
            try:
                with zipfile.ZipFile(jar_path) as jar:
                    names = set(jar.namelist())
                    descriptor_name = "META-INF/plugin.xml"
                    if descriptor_name not in names:
                        continue
                    root = ET.fromstring(jar.read(descriptor_name))
                    if (root.findtext("id") or "").strip() != plugin_id:
                        continue
                    raw_description = root.findtext("description") or ""
                    description = html.unescape(re.sub(r"<[^>]+>", " ", raw_description))
                    description = " ".join(description.split())
                    vendor = (root.findtext("vendor") or "").strip()
                    for candidate in (
                        "META-INF/pluginIcon.svg",
                        "META-INF/pluginIcon.png",
                        "META-INF/pluginIcon_dark.svg",
                        "pluginIcon.svg",
                    ):
                        if candidate in names:
                            icon_asset = (jar_path, candidate)
                            break
                    break
            except (OSError, zipfile.BadZipFile, ET.ParseError):
                continue

        icon_path = None
        if icon_asset:
            jar_path, member = icon_asset
            extension = Path(member).suffix.lower()
            icon_name = f"plugin-icon{extension}"
            with zipfile.ZipFile(jar_path) as jar:
                (output_dir / icon_name).write_bytes(jar.read(member))
            icon_path = f"plugins/{plugin_directory_name}/{icon_name}"

    capabilities = []
    for profile_path in profiles:
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
        image_name = profile.get("imageName")
        if not image_name:
            continue
        assets = [f"{image_name}.js", f"{image_name}.js.wasm"]
        worker_name = profile.get("browserWorkerName")
        if profile.get("browserApi") and worker_name:
            assets.append(worker_name)
        capabilities.append({
            "id": profile["id"],
            "description": profile.get("description", ""),
            "entrypoint": profile["entrypoint"],
            "assets": assets,
        })

    manifest = {
        "id": plugin_id,
        "name": plugin["name"],
        "version": plugin["version"],
        "description": description,
        "vendor": vendor,
        "icon": icon_path,
        "capabilities": capabilities,
    }
    manifest_path = output_dir / "plugin.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + chr(10),
        encoding="utf-8",
    )
    return manifest_path


def build_archive(archive: Path, args: argparse.Namespace, builder_module) -> int:
    print(f"\n=== Plugin archive: {archive.name} ===", flush=True)
    inventory = builder_module.inspect_plugin(archive)
    plugin = inventory["primaryPlugin"]
    if args.plugin and plugin["id"] != args.plugin:
        print(f"Skipping {archive.name}: contains {plugin['id']}, not requested {args.plugin}")
        return 0

    profiles = profiles_for(plugin["id"])
    print(f"Detected: {plugin['name']} ({plugin['id']} {plugin['version']})")
    print(f"Nested JAR/ZIP files: {inventory['nestedArchiveCount']}")
    if not profiles:
        print(f"BLOCKED: no batch-enabled build profile for plugin ID {plugin['id']}")
        print("Add a validated capability profile with batchEnabled=true.")
        return 3

    publish_profiles = frontend_profiles(profiles)
    if not publish_profiles:
        print(f"BLOCKED: no frontend-enabled capabilities are configured for {plugin['id']}")
        return 3

    failed_frontend_profiles: list[Path] = []
    failed_experimental_profiles: list[Path] = []
    build_outputs: dict[Path, Path] = {}
    with tempfile.TemporaryDirectory(prefix="webrains-plugin-build-") as temporary:
        temporary_root = Path(temporary)
        for profile in profiles:
            is_frontend_capability = profile in publish_profiles
            output_root = temporary_root / profile.stem
            command = [
                sys.executable, str(BUILDER), str(archive),
                "--profile", str(profile),
                "--output-root", str(output_root),
            ]
            if args.web_image:
                command.extend(["--web-image", args.web_image])
            if args.jdk:
                command.extend(["--jdk", args.jdk])
            if args.javac:
                command.extend(["--javac", args.javac])
            if args.node:
                command.extend(["--node", args.node])
            print(f"\n--- Building capability: {profile.stem} ---", flush=True)
            result = subprocess.run(command, cwd=ROOT, check=False)
            if result.returncode:
                target = failed_frontend_profiles if is_frontend_capability else failed_experimental_profiles
                target.append(profile)
                label = "FRONTEND BLOCKER" if is_frontend_capability else "EXPERIMENTAL ONLY"
                print(f"FAILED ({label}): {profile.name} (exit {result.returncode})", flush=True)
                continue
            try:
                build_outputs[profile] = build_output_for(output_root)
            except (OSError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as error:
                target = failed_frontend_profiles if is_frontend_capability else failed_experimental_profiles
                target.append(profile)
                print(f"FAILED (missing successful build output): {profile.name}: {error}", flush=True)

        if failed_frontend_profiles:
            print("\nFrontend plugin was not published because required browser capabilities failed:")
            for profile in failed_frontend_profiles:
                print(f"  - {profile.name}")
            return 1

        install_frontend_capabilities(publish_profiles, build_outputs, plugin["id"])
        manifest_path = write_frontend_manifest(archive, plugin, publish_profiles, builder_module)
        print(f"Plugin manifest: {manifest_path.relative_to(ROOT)}", flush=True)

    if failed_experimental_profiles:
        print("\nExperimental capabilities failed and were not published (the tested frontend capabilities are intact):")
        for profile in failed_experimental_profiles:
            print(f"  - {profile.name}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=Path, default=INPUT_ROOT,
        help="Directory containing one original plugin .zip per plugin (default: experiments/raw-plugins)",
    )
    parser.add_argument("--plugin", help="Build only the plugin with this descriptor ID")
    parser.add_argument("--web-image", help="Patched GraalVM web-image executable")
    parser.add_argument("--jdk", help="JDK home used by web-image")
    parser.add_argument("--javac", help="javac executable")
    parser.add_argument("--node", help="Node.js executable")
    parser.add_argument(
        "--continue-on-error", action="store_true",
        help="Continue processing remaining plugin ZIPs after a failed build",
    )
    args = parser.parse_args()
    input_root = args.input.expanduser()
    if not input_root.is_absolute():
        input_root = ROOT / input_root
    input_root.mkdir(parents=True, exist_ok=True)

    try:
        archives = plugin_archives(input_root)
    except RuntimeError as error:
        print(f"FAILED: {error}", file=sys.stderr)
        return 2

    builder_module = load_plugin_builder()
    archive_ids: dict[str, str] = {}
    matching_plugin_found = args.plugin is None
    try:
        for archive in archives:
            plugin_id = builder_module.inspect_plugin(archive)["primaryPlugin"]["id"]
            if plugin_id in archive_ids:
                raise RuntimeError(
                    f"Multiple ZIPs contain plugin ID {plugin_id!r}: "
                    f"{archive_ids[plugin_id]} and {archive.name}. Keep one version per plugin ID."
                )
            archive_ids[plugin_id] = archive.name
            matching_plugin_found = matching_plugin_found or plugin_id == args.plugin
    except (OSError, RuntimeError, ValueError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"FAILED during plugin archive discovery: {error}", file=sys.stderr)
        return 2

    if not matching_plugin_found:
        print(f"No plugin with descriptor ID {args.plugin!r} was found in {input_root}.", file=sys.stderr)
        return 2

    failures = []
    for archive in archives:
        try:
            result = build_archive(archive, args, builder_module)
        except (OSError, RuntimeError, ValueError, KeyError, zipfile.BadZipFile, json.JSONDecodeError) as error:
            print(f"FAILED: {archive.name}: {error}", file=sys.stderr)
            result = 2
        if result:
            failures.append((archive.name, result))
            if not args.continue_on_error:
                return result

    if failures:
        print("\nBuild failures:")
        for name, code in failures:
            print(f"  {name}: exit {code}")
        return 1
    print("\nAll frontend-enabled plugin capabilities built and runtime-tested successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
