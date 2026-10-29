# JetBrains plugin → browser build pipeline

This pipeline treats a JetBrains plugin archive as an input, records its identity and dependency metadata, and runs a **profile-defined** build/test for a specific capability. Generated build runs are kept out of Git under `experiments/plugin-builds/<plugin-id>/<version>/run-<UTC timestamp>/`.

## Run it

From the repository root, pass the plugin ZIP/JAR as the only required argument:

```sh
python3 scripts/plugin_web_build.py /path/to/jetbrains-plugin.zip
```

The tool reads `META-INF/plugin.xml` from nested plugin JARs, computes the archive SHA-256, inventories nested archives, and chooses a profile by plugin ID. When a profile exists, it extracts only the configured plugin JARs, compiles the declared entry point, invokes the configured Web Image compiler, checks that both `.js` and `.js.wasm` were produced, runs the runtime smoke test, and writes reports/logs beside the artifacts.

Useful modes/options:

```sh
python3 scripts/plugin_web_build.py /path/to/plugin.zip --inspect-only
python3 scripts/plugin_web_build.py /path/to/plugin.zip --profile experiments/plugin-build/profiles/example.json
python3 scripts/plugin_web_build.py /path/to/plugin.zip --web-image /path/to/web-image --javac /path/to/javac --jdk /path/to/jdk
```

The compiler can also be supplied with `WEB_IMAGE`, `JAVAC`, and `JAVA_HOME`. The default Web Image lookup uses the locally built compiler under the ignored GraalVM build output directory; the script automatically prefers an installed `~/.mx/jdks/labsjdk-ce-latest-jvmci-*` JDK when available, so the Python CE build needs no extra flags on this workstation. The Python CE profile additionally expects the matching IntelliJ platform JARs under `experiments/python-plugin/artifacts/.tools/idea-platform/`.

## Current profile

The default profile remains `profiles/python-ce-lexer.json`, targeting plugin ID `PythonCore`. It builds the unmodified original Python CE lexer with the host-side `LexerProbe` and expects `LEXER_OK tokens=22` at runtime. The original JetBrains JARs are only read; they are never patched. To install the lexer artifacts locally, run:

```sh
python3 scripts/plugin_web_build.py experiments/python-plugin/python-ce-263.7031.23.zip --install-frontend
```

The experimental keyword-completion profile is separate and must be selected explicitly:

```sh
python3 scripts/plugin_web_build.py experiments/python-plugin/python-ce-263.7031.23.zip --profile experiments/plugin-build/profiles/python-ce-completion.json --install-frontend
```

It compiles the original `PyKeywordCompletionContributor` against real Python PSI and expects `COMPLETION_JSON=["True"]` for the `if Tru` fixture. Its worker adapter is registered with the existing editor completion API and was verified in a Node worker-context harness for both `if Tru` → `True` and function-body `pas` → `pass`. The WASM module is about 34 MiB. The worker was smoke-tested in headless Firefox 159 with two sequential requests, but the React editor popup, deployment subpaths, and latency measurements remain unverified; this is keyword completion only, not a full Python CE plugin build. Generated `.js`, `.wasm`, and worker files go to the Git-ignored `frontend/public/plugins/pythoncore/` directory. See [`../../docs/python-ce-roadmap.md`](../../docs/python-ce-roadmap.md) for the current status and next steps.

Output layout:

```text
experiments/plugin-builds/
└── PythonCore/
    └── 263.7031.23/
        └── run-<UTC timestamp>/
            ├── inputs/       # probe source and reflection config
            ├── classes/      # compiled probe classes
            ├── web/          # browser-ready JavaScript wrapper and Wasm module
            └── reports/      # inventory, build status, and command logs

The extracted plugin JARs and compiler intermediates (including the large `.wat` file) are kept in the ignored, content-addressed cache under `experiments/python-plugin/artifacts/.tools/plugin-build-cache/`. This avoids duplicating hundreds of megabytes in every run. Only the `.js` and `.wasm` runtime files are copied into each run’s `web/` directory.
```

Each run is immutable and timestamped; a new run does not delete or overwrite a previous one. The root `experiments/plugin-builds/` is ignored by Git because generated bundles and compiler diagnostics can be large.

## What “drop any plugin” means today

The archive inspection and inventory stage is generic. Producing executable browser output is **not** generically possible from a plugin ZIP alone: GraalVM Web Image is ahead-of-time, so a profile must declare a reachable entry point, plugin/platform classpath, reflection/resource metadata, compiler options, and a meaningful runtime assertion. IntelliJ plugin descriptors do not provide that information, and many plugins rely on unavailable platform APIs or native processes.

For a plugin without a matching profile, the tool still creates an inventory report and `BUILD_BLOCKED.md`, then exits with code `3`. It does not emit a fake `.wasm` or claim success. Add a profile only after a concrete capability has been traced and tested. A successful profile proves only the capability it names, not that the full plugin runs unchanged.

## Status codes

- `0` — profile preflight succeeded, or a full configured build and runtime smoke test passed.
- `2` — invalid input, missing prerequisite, compiler failure, missing artifact, or failed assertion.
- `3` — plugin inspected successfully, but no compatible build profile exists.

## Local tests

```sh
python3 -m unittest discover -s experiments/plugin-build/tests -v
python3 scripts/plugin_web_build.py experiments/python-plugin/python-ce-263.7031.23.zip --inspect-only
```

The build profile deliberately retains the known IntelliJ platform JAR exclusions (`ijent`, `netty`, and `sqlite`) and the tested reflection configuration. These are recorded, explicit constraints of this current lexer capability, not general-purpose plugin workarounds.
