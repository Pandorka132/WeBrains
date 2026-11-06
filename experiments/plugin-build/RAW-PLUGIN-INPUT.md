# Raw plugin ZIP input

The build input directory is `experiments/raw-plugins/`. Put one original
JetBrains plugin distribution ZIP per plugin directly in that directory:

```text
experiments/raw-plugins/
  python-ce.zip
  kotlin.zip
  another-plugin.zip
```

The directory is intentionally kept free of documentation, extracted files
and subdirectories: only plugin `.zip` archives belong there. If the directory
does not exist yet (for example, after a fresh clone), the build script
creates it and reports that no ZIPs were found.

Each ZIP must retain the original plugin distribution layout, including its
`lib/*.jar` / `lib/modules/*.jar` files and the JAR containing
`META-INF/plugin.xml`. Do not extract the ZIPs before placing them there.

Run from the repository root:

```sh
python scripts/build_plugins.py
```

The orchestrator scans every ZIP, identifies its plugin from the descriptor,
and runs all matching profiles marked `batchEnabled: true`. Only profiles
also marked `frontendEnabled: true` are published to the app, and only after
every such profile passes its build and runtime test. Other batch profiles are
experimental validation runs: they are tested, but are not advertised as
loaded browser capabilities. The original ZIPs are read-only inputs. Nested
JARs are extracted only into the local build cache.

To process one plugin by its descriptor ID:

```sh
python scripts/build_plugins.py --plugin PythonCore
```

Successfully built artifacts are installed under
`frontend/public/plugins/<plugin-id>/`. A ZIP without a validated browser
capability profile is reported as blocked; it is not presented as a working
browser plugin.
