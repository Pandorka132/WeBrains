# CI plugin build toolchain

The Pages workflow builds the browser capabilities from the pinned plugin distributions in `plugins.json` before Vite runs. It downloads those original ZIPs from the official JetBrains Marketplace download endpoint, verifies each ZIP and its embedded `META-INF/plugin.xml` ID/version, then runs `scripts/build_plugins.py`. Only capabilities whose configured Web Image build and runtime test pass are copied into `frontend/public/plugins/` and included in the Pages artifact.

## One-time toolchain release

Web Image is built from a locally patched GraalVM source tree and depends on the exact platform JAR set, LabsJDK, and Binaryen assembler. Rebuilding that compiler on every GitHub runner would be wasteful. Package the already-built, verified Linux x86_64 toolchain as immutable GitHub Release assets instead:

```bash
python scripts/package_plugin_toolchain.py \
  --jdk "$HOME/.mx/jdks/labsjdk-ce-latest-jvmci-25.5-b24_amd64"
```

The script packages the GraalVM distribution and LabsJDK into the runtime archive, and the IntelliJ platform JARs, `wasm-as`, and `nativeimage.jar` into the platform archive. It writes SHA-256 checksums and checks that each archive is below GitHub's 2 GB per-asset limit. The packaging script expects exactly one patched Web Image distribution under `experiments/python-plugin/artifacts/.tools/graalvm-source/sdk/mxbuild/linux-amd64/GRAALVM_*/` and the existing local build inputs.

After reviewing the generated archive sizes and checksums, publish the three generated files as assets on a release tagged `webrains-toolchain-v1`:

```bash
gh release create webrains-toolchain-v1 \
  --title 'WeBrains plugin build toolchain v1' \
  experiments/plugin-build/toolchain-release/webrains-toolchain-linux-x86_64-runtime.tar.zst \
  experiments/plugin-build/toolchain-release/webrains-toolchain-linux-x86_64-platform.tar.zst \
  experiments/plugin-build/toolchain-release/webrains-toolchain-linux-x86_64-SHA256SUMS
```

The workflow downloads these assets using its read-only `GITHUB_TOKEN`, verifies both archives against the checksum file, and extracts them at the paths expected by the existing build profile. Updating the compiler, JDK, platform JAR set, or Binaryen requires publishing a new versioned toolchain release and changing `TOOLCHAIN_RELEASE` in `.github/workflows/deploy-pages.yml`.

## Updating plugin inputs

Add one entry to `plugins.json` per pinned Marketplace distribution, using its exact Plugin XML ID, version, and ZIP filename. The download script rejects duplicate IDs/filenames and validates the descriptor inside every downloaded archive. A plugin without a matching batch-enabled and frontend-enabled profile still cannot be published as a browser capability.
