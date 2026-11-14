#!/usr/bin/env python3
"""Package the locally verified Linux Web Image toolchain as GitHub Release assets."""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "experiments" / "python-plugin" / "artifacts" / ".tools"
RELEASE_LIMIT = 2_000_000_000


def only_match(paths: list[Path], description: str) -> Path:
    existing = sorted(path for path in paths if path.exists())
    if len(existing) != 1:
        raise RuntimeError(f"Expected exactly one {description}, found {len(existing)}: {existing}")
    return existing[0].resolve()


def run_tar(output: Path, args: list[str]) -> None:
    command = ["tar", "--zstd", "-cf", str(output), *args]
    print("$ " + " ".join(command), flush=True)
    subprocess.run(command, check=True)
    size = output.stat().st_size
    if size > RELEASE_LIMIT:
        raise RuntimeError(f"{output.name} is {size:,} bytes; GitHub Release assets are limited to 2 GB.")
    print(f"Created {output.name}: {size:,} bytes", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk", type=Path, help="Exact LabsJDK home used for the verified build")
    parser.add_argument("--output", type=Path, default=ROOT / "experiments" / "plugin-build" / "toolchain-release")
    args = parser.parse_args()

    zstd = shutil.which("zstd")
    if not zstd:
        raise RuntimeError("zstd is required (install the zstd package).")
    graalvm = only_match(
        list((TOOLS / "graalvm-source" / "sdk" / "mxbuild" / "linux-amd64").glob("GRAALVM_*/graalvm-*/lib/svm/tools/web-image/bin/web-image")),
        "patched GraalVM Web Image launcher",
    )
    graalvm_home = graalvm.parents[5]
    if not (graalvm_home / "bin" / "java").is_file():
        raise RuntimeError(f"Resolved GraalVM home is incomplete: {graalvm_home}")
    jdk = args.jdk.expanduser().resolve() if args.jdk else only_match(
        list((Path.home() / ".mx" / "jdks").glob("labsjdk-ce-latest-jvmci-*")), "LabsJDK home"
    )
    if not all((jdk / "bin" / executable).is_file() for executable in ("java", "javac")):
        raise RuntimeError(f"JDK home must contain bin/java and bin/javac: {jdk}")

    platform = TOOLS / "idea-platform"
    wasm_as = TOOLS / "binaryen" / "bin" / "wasm-as"
    nativeimage_jar = TOOLS / "graalvm-source" / "sdk" / "mxbuild" / "jdk25" / "dists" / "jdk11" / "nativeimage.jar"
    for required in (platform, wasm_as, nativeimage_jar):
        if not required.exists():
            raise RuntimeError(f"Required build input is missing: {required}")
    if not any(platform.glob("*.jar")):
        raise RuntimeError(f"No IntelliJ platform JARs found in {platform}")

    output = args.output.expanduser()
    if not output.is_absolute():
        output = ROOT / output
    output.mkdir(parents=True, exist_ok=True)
    runtime_archive = output / "webrains-toolchain-linux-x86_64-runtime.tar.zst"
    platform_archive = output / "webrains-toolchain-linux-x86_64-platform.tar.zst"
    graal_parent, graal_name = graalvm_home.parent, graalvm_home.name
    jdk_parent, jdk_name = jdk.parent, jdk.name
    run_tar(runtime_archive, [
        "-C", str(graal_parent), f"--transform=s|^{graal_name}|toolchain/graalvm|", graal_name,
        "-C", str(jdk_parent), f"--transform=s|^{jdk_name}|toolchain/jdk|", jdk_name,
    ])
    run_tar(platform_archive, [
        "-C", str(ROOT),
        str(platform.relative_to(ROOT)),
        str(wasm_as.relative_to(ROOT)),
        str(nativeimage_jar.relative_to(ROOT)),
    ])

    checksums = output / "webrains-toolchain-linux-x86_64-SHA256SUMS"
    lines = []
    for archive in (runtime_archive, platform_archive):
        digest = hashlib.sha256()
        with archive.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        lines.append(f"{digest.hexdigest()}  {archive.name}")
    checksums.write_text("\n".join(lines) + "\n", encoding="ascii")
    print(f"Release assets are ready in {output}")
    print("Create the release with:")
    print("gh release create webrains-toolchain-v1 --title 'WeBrains plugin build toolchain v1' " + " ".join(str(output / name) for name in (runtime_archive.name, platform_archive.name, checksums.name)))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Toolchain packaging failed: {error}", file=sys.stderr)
        raise SystemExit(1)
