# Plugin system

`plugins.ts` currently validates WebBrains browser-plugin manifests, dependencies, and
activation order. It does not load JAR files or execute IntelliJ plugins.

Keep catalog/descriptor concerns here. A future bytecode execution backend should be a
separate implementation and must not be implied by the current catalog API.
