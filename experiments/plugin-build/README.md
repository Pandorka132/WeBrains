# Browser plugin build pipeline

The pipeline accepts original JetBrains plugin distribution ZIPs and uses
explicit capability profiles to build browser-compatible artifacts.

## Input

Place one original plugin ZIP per plugin directly in:

```text
experiments/raw-plugins/
  python-ce.zip
  kotlin.zip
```

Do not unpack the archives or create subdirectories. The ZIP must preserve
its original distribution layout and contain the plugin descriptor
(`META-INF/plugin.xml`) either at the archive root or inside one of its JARs.
The input ZIPs are ignored by Git so proprietary or licensed plugin binaries
are not accidentally committed.

## Build

```sh
python scripts/build_plugins.py --web-image /path/to/web-image
```

The script processes every ZIP in `experiments/raw-plugins/` sequentially.
Each archive is inspected to discover its plugin ID, name, version and nested
JARs. The matching profiles (`pluginId` plus `batchEnabled: true`) are built
one after another. A profile must additionally set `frontendEnabled: true`
to be part of the browser app. Those production capabilities must all build
and pass their runtime assertions before their assets and `plugin.json` are
published. Experimental profiles can still be built and tested, but their
failure does not block the separately validated frontend capability set and
they are never listed in the manifest. To process one plugin only:

```sh
python scripts/build_plugins.py --plugin PythonCore --web-image /path/to/web-image
```

A profile describes one concrete browser capability: Java entry point and
source files, plugin JAR selection, platform JAR directory, GraalVM options,
reflection/proxy/resource metadata, browser worker adapter and runtime
assertion. A plugin without a validated profile is inventoried but is not
represented as a successful browser build. The pipeline does not attempt to
translate arbitrary IntelliJ APIs automatically.

## Output

Successfully built artifacts are installed into a plugin-specific directory:

```text
frontend/public/plugins/<plugin-id>/
  plugin.json
  plugin-icon.svg        # if the source plugin contains one
  <capability>.js
  <capability>.js.wasm
  <capability>.worker.js # if that profile declares a worker
```

Vite discovers these manifests from `frontend/public/plugins/` and injects
validated metadata into the app before its entry module runs. The dev server
watches `plugin.json` changes and reloads the app, so adding or rebuilding a
plugin does not require a hardcoded frontend entry. The Plugin Manager lists
only plugins that actually activate in the runtime.

`plugin.json` is generated from the source plugin descriptor (name, version,
description, vendor, icon) and the capabilities that passed their runtime
smoke tests. The original ZIPs remain untouched. Build reports and compiler
outputs are kept under `experiments/plugin-builds/` and the shared compiler
cache under `experiments/plugin-build/cache/`.

Profiles are intentionally separate from the build engine. New plugin support
should add a profile only after identifying the original implementation entry
point, required platform dependencies and a meaningful runtime test.

See [the raw plugin input notes](RAW-PLUGIN-INPUT.md) for the expected ZIP layout and input rules.
