#!/usr/bin/env python3
"""Inspect a JetBrains plugin ZIP and build a profile-backed browser artifact."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PROFILE_DIR = ROOT / "experiments" / "plugin-build" / "profiles"
DEFAULT_OUTPUT = ROOT / "experiments" / "plugin-builds"
DEFAULT_CACHE = ROOT / "experiments" / "python-plugin" / "artifacts" / ".tools" / "plugin-build-cache"
DEFAULT_PLATFORM = ROOT / "experiments" / "python-plugin" / "artifacts" / ".tools" / "idea-platform"
DEFAULT_GRAAL_BUILD = ROOT / "experiments" / "python-plugin" / "artifacts" / ".tools" / "graalvm-build-output-master"
ACTIVE_OUTPUT: Path | None = None


class BuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-")
    return cleaned or "unknown-plugin"


def parse_descriptor(xml_bytes: bytes, source: str) -> dict[str, Any] | None:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None
    plugin_id = (root.findtext("id") or "").strip()
    name = (root.findtext("name") or "").strip()
    version = (root.findtext("version") or "").strip()
    if not plugin_id or not name:
        return None
    idea_version = root.find("idea-version")
    dependencies = []
    for dependency in root.findall("depends"):
        dep_id = (dependency.text or "").strip()
        if dep_id:
            dependencies.append({"id": dep_id, "optional": dependency.get("optional", "false").lower() == "true"})
    return {
        "id": plugin_id,
        "name": name,
        "version": version or "unspecified",
        "descriptor": source,
        "sinceBuild": idea_version.get("since-build") if idea_version is not None else None,
        "untilBuild": idea_version.get("until-build") if idea_version is not None else None,
        "dependencies": dependencies,
    }


def inspect_plugin(archive: Path) -> dict[str, Any]:
    if not zipfile.is_zipfile(archive):
        raise BuildError(f"Input is not a ZIP/JAR plugin archive: {archive}")
    descriptors: list[dict[str, Any]] = []
    jar_entries: list[str] = []
    other_count = 0
    with zipfile.ZipFile(archive) as outer:
        for info in outer.infolist():
            if info.is_dir():
                continue
            name = info.filename
            if name.endswith("META-INF/plugin.xml"):
                try:
                    parsed = parse_descriptor(outer.read(info), name)
                    if parsed:
                        descriptors.append(parsed)
                except (KeyError, RuntimeError):
                    pass
            if name.lower().endswith((".jar", ".zip")):
                jar_entries.append(name)
                try:
                    nested_bytes = outer.read(info)
                    with zipfile.ZipFile(io.BytesIO(nested_bytes)) as nested:
                        for descriptor_name in nested.namelist():
                            if descriptor_name.endswith("META-INF/plugin.xml"):
                                parsed = parse_descriptor(nested.read(descriptor_name), f"{name}!/{descriptor_name}")
                                if parsed:
                                    descriptors.append(parsed)
                except (zipfile.BadZipFile, KeyError, RuntimeError):
                    pass
            else:
                other_count += 1
    # Prefer the root plugin descriptor over embedded descriptors if an archive has several.
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for item in descriptors:
        unique[(item["id"], item["version"])] = item
    descriptors = list(unique.values())
    if not descriptors:
        raise BuildError("No valid META-INF/plugin.xml descriptor was found in the archive or its nested JARs.")
    descriptors.sort(key=lambda item: ("!" in item["descriptor"], item["id"]))
    return {
        "archive": str(archive.resolve()),
        "archiveSha256": sha256_file(archive),
        "archiveBytes": archive.stat().st_size,
        "pluginDescriptors": descriptors,
        "primaryPlugin": descriptors[0],
        "nestedArchives": sorted(jar_entries),
        "nestedArchiveCount": len(jar_entries),
        "nonArchiveFileCount": other_count,
    }


def load_profile(profile_arg: str | None, plugin: dict[str, Any]) -> tuple[dict[str, Any] | None, Path | None]:
    if profile_arg:
        path = Path(profile_arg).expanduser()
        if not path.is_absolute():
            path = ROOT / path
        if not path.is_file():
            raise BuildError(f"Profile does not exist: {path}")
        profile = json.loads(path.read_text(encoding="utf-8"))
        return profile, path.resolve()
    candidates = sorted(PROFILE_DIR.glob("*.json")) if PROFILE_DIR.exists() else []
    matches: list[tuple[dict[str, Any], Path]] = []
    for path in candidates:
        profile = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(profile, dict):
            continue
        if profile.get("pluginId") == plugin["id"]:
            matches.append((profile, path.resolve()))
    if not matches:
        return None, None
    # Preserve the existing default frontend-install workflow when several experimental
    # capabilities have profiles for the same plugin. New probes must be selected explicitly.
    default = next((match for match in matches if match[0].get("id") == "python-ce-lexer-wasmgc"), None)
    return default or matches[0]


def extract_plugin_jars(archive: Path, destination: Path, include_globs: list[str]) -> list[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    marker = destination / ".complete.json"
    if marker.is_file():
        cached = json.loads(marker.read_text(encoding="utf-8"))
        paths = [destination / item for item in cached.get("jars", [])]
        if paths and all(path.is_file() for path in paths):
            return paths
    extracted: list[Path] = []
    with zipfile.ZipFile(archive) as outer:
        for name in sorted(outer.namelist()):
            if not name.lower().endswith(".jar"):
                continue
            if include_globs and not any(PurePosixPath(name).match(pattern) for pattern in include_globs):
                continue
            relative = PurePosixPath(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise BuildError(f"Unsafe archive path: {name}")
            target = destination.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(outer.read(name))
            extracted.append(target)
    if not extracted:
        raise BuildError("The selected profile did not match any plugin JARs in the archive.")
    marker.write_text(json.dumps({"jars": [str(path.relative_to(destination)) for path in extracted]}, indent=2) + "\n", encoding="utf-8")
    return extracted


def resolve_graal(profile: dict[str, Any], cli_value: str | None) -> Path:
    configured = cli_value or os.environ.get("WEB_IMAGE") or profile.get("webImage")
    candidates: list[Path] = []
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        candidates.append(candidate)
    else:
        candidates.extend(sorted(DEFAULT_GRAAL_BUILD.glob("sdk/**/bin/web-image")))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
    raise BuildError("GraalVM Web Image executable not found. Build the patched GraalVM source first or pass --web-image / set WEB_IMAGE.")


def resolve_jdk(cli_value: str | None, profile: dict[str, Any]) -> Path | None:
    configured = cli_value or os.environ.get("JAVA_HOME") or profile.get("jdkHome")
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if (candidate / "bin" / "java").is_file():
            return candidate
        raise BuildError(f"JDK home does not contain bin/java: {candidate}")
    mx_jdks = Path.home() / ".mx" / "jdks"
    candidates = sorted(mx_jdks.glob("labsjdk-ce-latest-jvmci-*")) if mx_jdks.is_dir() else []
    for candidate in reversed(candidates):
        if (candidate / "bin" / "java").is_file() and (candidate / "bin" / "javac").is_file():
            return candidate.resolve()
    return None


def resolve_javac(cli_value: str | None, profile: dict[str, Any], jdk_home: Path | None = None) -> Path:
    configured = cli_value or os.environ.get("JAVAC") or profile.get("javac")
    if not configured and jdk_home and (jdk_home / "bin" / "javac").is_file():
        return (jdk_home / "bin" / "javac").resolve()
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate.resolve()
        raise BuildError(f"javac executable not found: {candidate}")
    found = shutil.which("javac")
    if found:
        return Path(found).resolve()
    raise BuildError("javac not found. Set JAVA_HOME or pass --javac.")


def classpath_for(profile: dict[str, Any], extracted_jars: list[Path], output: Path) -> list[Path]:
    entries: list[Path] = [*extracted_jars]
    platform = profile.get("platform", {})
    platform_dir = Path(platform.get("jarDirectory", str(DEFAULT_PLATFORM))).expanduser()
    if not platform_dir.is_absolute():
        platform_dir = ROOT / platform_dir
    if platform.get("required", True):
        if not platform_dir.is_dir():
            raise BuildError(f"Required IntelliJ platform JAR directory is missing: {platform_dir}")
        excludes = [str(item).lower() for item in platform.get("excludeJarNameContains", [])]
        entries.extend(
            jar for jar in sorted(platform_dir.glob("*.jar"))
            if not any(fragment in jar.name.lower() for fragment in excludes)
        )
    entries.append(output / "classes")
    # Stable order and path deduplication matter for repeatable class resolution.
    seen: set[str] = set()
    result: list[Path] = []
    for entry in entries:
        key = str(entry.resolve())
        if key not in seen:
            seen.add(key)
            result.append(entry.resolve())
    return result


def run_command(command: list[str], cwd: Path, log_path: Path, env: dict[str, str] | None = None) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + " ".join(command) + "\n\n")
        log.flush()
        process = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, text=True)
    if process.returncode != 0:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-35:])
        raise BuildError(f"Command failed with exit code {process.returncode}: {command[0]}\nLog: {log_path}\n\nLast output lines:\n{tail}")


def adapt_browser_wrapper(js_path: Path) -> None:
    """Expose tokenization and accept a precompiled WASM module in browser workers."""
    source = js_path.read_text(encoding="utf-8")
    new_instantiate = '''async function wasmInstantiate(config, args) {
    let instance;
    if (globalThis.__pythonCeWasmModule instanceof WebAssembly.Module) {
        instance = await WebAssembly.instantiate(globalThis.__pythonCeWasmModule, wasmImports);
    } else {
        const wasmPath = config.wasm_path || runtime.getCurrentFile() + ".wasm";
        const file = await runtime.fetchData(wasmPath);
        const result = await WebAssembly.instantiate(file, wasmImports);
        instance = result.instance;
    }
    return {
        instance,
        memory: instance.exports.memory,
    };
}'''
    source, replacements = re.subn(r"async function wasmInstantiate\(config, args\) \{.*?^\}", lambda _: new_instantiate, source, count=1, flags=re.MULTILINE | re.DOTALL)
    if replacements != 1:
        raise BuildError("Generated Web Image wrapper has an unexpected WASM-instantiation layout; browser module cache patch was not applied.")
    old_tail = '''const config = new GraalVM.Config();\nGraalVM.run(load_cmd_args(),config).catch(e => { console.error(e); throw e; });\n})();'''
    new_tail = '''const config = new GraalVM.Config();\nif (typeof self === \"object\" && typeof self.location === \"object\") {\n    config.wasm_path = new URL(\"./python-ce-lexer.js.wasm\", self.location.href).href;\n}\nglobalThis.__pythonCeStart = (source, caretOffset) => {\n    if (typeof source !== \"string\") {\n        throw new TypeError(\"Python source must be a string\");\n    }\n    const args = Number.isInteger(caretOffset) ? [source, String(caretOffset)] : [source];\n    return GraalVM.run(args, config).then(() => {\n        if (typeof self === \"object\" && typeof self.postMessage === \"function\") {\n            self.postMessage({ type: \"complete\", requestId: globalThis.__pythonCeRequestId });\n        }\n    }).catch(error => {\n        if (typeof self === \"object\" && typeof self.postMessage === \"function\") {\n            self.postMessage({ type: \"error\", requestId: globalThis.__pythonCeRequestId, message: String(error) });\n        }\n        throw error;\n    });\n};\nif (!(typeof document === \"undefined\" && typeof self === \"object\" && typeof self.postMessage === \"function\")) {\n    GraalVM.run(load_cmd_args(), config).catch(error => { console.error(error); throw error; });\n}\n})();'''
    new_tail = new_tail.replace("python-ce-lexer.js.wasm", f"{js_path.name}.wasm")
    if source.count(old_tail) != 1:
        raise BuildError("Generated Web Image wrapper has an unexpected entry-point layout; browser API patch was not applied.")
    js_path.write_text(source.replace(old_tail, new_tail, 1), encoding="utf-8")


def build(args: argparse.Namespace) -> int:
    global ACTIVE_OUTPUT
    archive = Path(args.plugin).expanduser().resolve()
    if not archive.is_file():
        raise BuildError(f"Plugin archive does not exist: {archive}")
    report = inspect_plugin(archive)
    plugin = report["primaryPlugin"]
    profile, profile_path = load_profile(args.profile, plugin)

    output_root = Path(args.output_root).expanduser()
    if not output_root.is_absolute():
        output_root = ROOT / output_root
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = output_root / safe_component(plugin["id"]) / safe_component(plugin["version"]) / f"run-{stamp}"
    output.mkdir(parents=True, exist_ok=False)
    ACTIVE_OUTPUT = output
    (output / "reports").mkdir()
    report["profile"] = str(profile_path) if profile_path else None
    report["status"] = "DISCOVERED_ONLY" if profile is None else "PREFLIGHT"
    report["outputDirectory"] = str(output.resolve())
    (output / "reports" / "plugin-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "reports" / "plugin-inventory.md").write_text(render_inventory(report), encoding="utf-8")

    print(f"Plugin: {plugin['name']} ({plugin['id']} {plugin['version']})")
    print(f"Archive SHA-256: {report['archiveSha256']}")
    print(f"Nested JAR/ZIP files: {report['nestedArchiveCount']}")
    print(f"Output: {output}")
    if profile is None:
        report["status"] = "BLOCKED_NO_PROFILE"
        report["blockers"] = [
            "No build profile matches this plugin ID.",
            "A browser artifact requires an explicit entry point, supported classpath, reflection/resources metadata, and runtime test. The pipeline will not label an inventory-only result as a successful WebAssembly build.",
        ]
        (output / "reports" / "plugin-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (output / "reports" / "BUILD_BLOCKED.md").write_text(
            "# Build blocked: no compatibility profile\n\n"
            f"Plugin: `{plugin['id']}` version `{plugin['version']}`\n\n"
            "The archive was inspected and inventoried, but no browser executable was generated. "
            "Create a profile under `experiments/plugin-build/profiles/` after selecting a concrete capability and validating its dependencies.\n",
            encoding="utf-8",
        )
        print("Status: BLOCKED_NO_PROFILE (inventory generated; no fake browser output was produced)")
        return 3

    if profile.get("pluginId") != plugin["id"]:
        raise BuildError(f"Profile {profile_path} targets {profile.get('pluginId')!r}, not {plugin['id']!r}.")
    if args.inspect_only:
        report["status"] = "PROFILE_PREFLIGHT_ONLY"
        report["profile"] = str(profile_path)
        (output / "reports" / "plugin-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"Profile: {profile.get('id')} (preflight only; no compiler invoked)")
        return 0

    include_globs = profile.get("pluginJarIncludes", ["**/*.jar"])
    plugin_cache = DEFAULT_CACHE / report["archiveSha256"] / "plugin-jars"
    plugin_jars = extract_plugin_jars(archive, plugin_cache, include_globs)
    source_files = profile.get("sourceFiles", [])
    if not source_files:
        raise BuildError("Profile has no sourceFiles entry; refusing to build without an explicit capability entry point.")
    sources: list[Path] = []
    for source in source_files:
        path = Path(source)
        if not path.is_absolute():
            path = ROOT / path
        if not path.is_file():
            raise BuildError(f"Profile source file does not exist: {path}")
        sources.append(path.resolve())
    source_dir = output / "inputs" / "sources"
    source_dir.mkdir(parents=True, exist_ok=True)
    copied_sources: list[Path] = []
    for source in sources:
        target = source_dir / source.name
        shutil.copy2(source, target)
        copied_sources.append(target)

    classpath = classpath_for(profile, plugin_jars, output)
    classpath_text = os.pathsep.join(str(item) for item in classpath)
    classes = output / "classes"
    classes.mkdir()
    jdk_home = resolve_jdk(args.jdk, profile)
    javac = resolve_javac(args.javac, profile, jdk_home)
    java_env = os.environ.copy()
    if jdk_home:
        java_env["JAVA_HOME"] = str(jdk_home)
        java_env["PATH"] = str(jdk_home / "bin") + os.pathsep + java_env.get("PATH", "")
    run_command([str(javac), "-proc:none", "-encoding", "UTF-8", "-cp", classpath_text, "-d", str(classes), *map(str, copied_sources)], ROOT, output / "reports" / "javac.log", java_env)

    web_image = resolve_graal(profile, args.web_image)
    reflection_config = profile.get("reflectionConfig")
    command = [str(web_image), "-cp", classpath_text]
    if reflection_config:
        config_path = Path(reflection_config)
        if not config_path.is_absolute():
            config_path = ROOT / config_path
        if not config_path.is_file():
            raise BuildError(f"Reflection config does not exist: {config_path}")
        copied_config = output / "inputs" / "reflection-config.json"
        copied_config.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(config_path, copied_config)
        command.append(f"-H:ReflectionConfigurationFiles={copied_config}")
    for option in profile.get("imageOptions", []):
        command.append(str(option).replace("{output}", str(output / "web")))
    web_dir = output / "web"
    web_dir.mkdir()
    compiler_output_dir = DEFAULT_CACHE / report["archiveSha256"] / safe_component(str(profile.get("id", "profile"))) / "compiler-output"
    compiler_output_dir.mkdir(parents=True, exist_ok=True)
    image_name = safe_component(profile.get("imageName", plugin["id"]).lower())
    command.extend([f"-H:Name={image_name}", f"-H:Path={compiler_output_dir}", profile["entrypoint"]])
    run_command(command, ROOT, output / "reports" / "web-image.log", java_env)

    compiled_js = compiler_output_dir / f"{image_name}.js"
    compiled_wasm = compiler_output_dir / f"{image_name}.js.wasm"
    if not compiled_js.is_file() or not compiled_wasm.is_file():
        raise BuildError(f"Compiler exited successfully but expected outputs are missing: {compiled_js.name}, {compiled_wasm.name}")
    js_output = web_dir / compiled_js.name
    wasm_output = web_dir / compiled_wasm.name
    shutil.copy2(compiled_js, js_output)
    shutil.copy2(compiled_wasm, wasm_output)
    if profile.get("browserApi"):
        adapt_browser_wrapper(js_output)
        worker_template = ROOT / str(profile.get(
            "browserWorkerTemplate",
            "experiments/plugin-build/templates/python-ce-lexer.worker.js",
        ))
        worker_name = str(profile.get("browserWorkerName", "python-ce-lexer.worker.js"))
        if not worker_template.is_file():
            raise BuildError(f"Browser worker template is missing: {worker_template}")
        shutil.copy2(worker_template, web_dir / worker_name)

    test_config = profile.get("runtimeTest", {})
    if test_config.get("command"):
        test_command = [str(part).replace("{js}", str(js_output)).replace("{wasm}", str(wasm_output)) for part in test_config["command"]]
    else:
        node = args.node or shutil.which("node")
        if not node:
            raise BuildError("Node.js is required for the configured runtime smoke test. Pass --node or set PATH.")
        test_command = [node, str(js_output)]
    run_command(test_command, ROOT, output / "reports" / "runtime-test.log", java_env)
    runtime_output = (output / "reports" / "runtime-test.log").read_text(encoding="utf-8", errors="replace")
    expected = test_config.get("expectedOutput")
    if expected and expected not in runtime_output:
        raise BuildError(f"Runtime command exited successfully but expected marker was absent: {expected!r}")

    report["status"] = "BUILD_AND_RUNTIME_TEST_PASSED"
    report["profile"] = str(profile_path)
    report["build"] = {
        "profileId": profile.get("id"),
        "entrypoint": profile["entrypoint"],
        "compiler": str(web_image),
        "pluginJarCount": len(plugin_jars),
        "classpathEntryCount": len(classpath),
        "outputs": [str(js_output.relative_to(output)), str(wasm_output.relative_to(output))],
        "runtimeTest": test_command,
        "expectedOutput": expected,
    }
    (output / "reports" / "plugin-inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "reports" / "BUILD_PASSED.md").write_text(
        "# Build and runtime smoke test passed\n\n"
        f"- Plugin: `{plugin['id']}` `{plugin['version']}`\n"
        f"- Profile: `{profile.get('id')}`\n"
        f"- Entry point: `{profile['entrypoint']}`\n"
        f"- JavaScript runtime wrapper: `web/{js_output.name}`\n"
        f"- WebAssembly module: `web/{wasm_output.name}`\n"
        + (f"- Browser worker adapter: `web/{profile.get('browserWorkerName', 'python-ce-lexer.worker.js')}`\n" if profile.get("browserApi") else "")
        + f"- Runtime assertion: `{expected or 'process exited successfully'}`\n\n"
        + "This result proves only the capability named by this profile; it does not claim the entire plugin is browser-compatible.\n",
        encoding="utf-8",
    )
    if getattr(args, "install_frontend", False):
        frontend_plugin_dir = ROOT / "frontend" / "public" / "plugins" / safe_component(str(plugin["id"]).lower())
        frontend_plugin_dir.mkdir(parents=True, exist_ok=True)
        for artifact in web_dir.iterdir():
            if artifact.is_file():
                shutil.copy2(artifact, frontend_plugin_dir / artifact.name)
        print(f"Installed browser artifacts for local frontend testing: {frontend_plugin_dir}")
    print(f"Status: BUILD_AND_RUNTIME_TEST_PASSED ({profile.get('id')})")
    print(f"Web output: {web_dir}")
    return 0


def render_inventory(report: dict[str, Any]) -> str:
    plugin = report["primaryPlugin"]
    deps = plugin.get("dependencies", [])
    lines = [
        "# Plugin inventory", "", f"- **Name:** {plugin['name']}", f"- **ID:** `{plugin['id']}`",
        f"- **Version:** `{plugin['version']}`", f"- **Archive SHA-256:** `{report['archiveSha256']}`",
        f"- **Nested archives:** {report['nestedArchiveCount']}", f"- **Other files:** {report['nonArchiveFileCount']}",
        f"- **IDE build range:** `{plugin.get('sinceBuild') or 'unspecified'}` .. `{plugin.get('untilBuild') or 'unspecified'}`",
        "", "## Declared dependencies", "",
    ]
    lines.extend(f"- `{dep['id']}`{' (optional)' if dep['optional'] else ''}" for dep in deps)
    if not deps:
        lines.append("- No top-level `<depends>` entries found.")
    lines.extend(["", "## Nested archives", "", *[f"- `{name}`" for name in report["nestedArchives"]], ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin", help="Path to a JetBrains plugin ZIP/JAR archive")
    parser.add_argument("--profile", help="Explicit JSON build profile; otherwise auto-select by plugin ID")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT.relative_to(ROOT)), help="Generated output root (default: experiments/plugin-builds)")
    parser.add_argument("--inspect-only", action="store_true", help="Inspect the archive and validate profile selection without compiling")
    parser.add_argument("--web-image", help="Path to the patched GraalVM Web Image executable (or set WEB_IMAGE)")
    parser.add_argument("--javac", help="Path to javac (or set JAVAC)")
    parser.add_argument("--jdk", help="JDK home used by GraalVM Web Image")
    parser.add_argument("--node", help="Node.js executable used for runtime smoke test")
    parser.add_argument("--install-frontend", action="store_true", help="Copy successfully tested web artifacts into frontend/public/plugins/<plugin-id> for local frontend testing")
    args = parser.parse_args()
    try:
        return build(args)
    except (BuildError, OSError, zipfile.BadZipFile, json.JSONDecodeError, KeyError, ValueError) as error:
        if ACTIVE_OUTPUT is not None and ACTIVE_OUTPUT.is_dir():
            report_path = ACTIVE_OUTPUT / "reports" / "plugin-inventory.json"
            try:
                report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else {}
                report["status"] = "BUILD_FAILED"
                report["error"] = str(error)
                report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
                (ACTIVE_OUTPUT / "reports" / "BUILD_FAILED.md").write_text(f"# Build failed\n\n{error}\n", encoding="utf-8")
                print(f"Output with logs: {ACTIVE_OUTPUT}", file=sys.stderr)
            except (OSError, json.JSONDecodeError):
                pass
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
