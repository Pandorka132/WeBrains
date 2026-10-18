# IntelliJ Platform API compatibility strategy

## Goal and compatibility levels

WebBrains is a static React + TypeScript application. Its production code runs in the browser; Node.js is used only for development and builds. The compatibility goal is to make carefully selected IntelliJ Platform concepts useful through browser-native implementations and explicit adapters. Upstream API compatibility is a long-term direction, not a capability already delivered.

Compatibility has three distinct levels:

1. **API shape compatibility**: familiar concepts, names, and type relationships can make it practical to port selected source code. Similar names do not imply identical contracts.
2. **Behavioral compatibility**: observable lifecycle, ordering, editing, PSI, indexing, threading, and UI behavior match the relevant upstream contract. This requires conformance tests for each supported API slice.
3. **Runtime/binary compatibility**: loading arbitrary IntelliJ plugin JARs and executing their Java/Kotlin bytecode against the platform. The browser foundation does not provide this. Static JavaScript imports, JavaScript/WASM code, and JVM bytecode are different execution formats.

The current TypeScript foundation implements small browser-oriented primitives. It does not claim IntelliJ binary compatibility, parse arbitrary `plugin.xml` descriptors, or run JetBrains plugin code. `BrowserPluginManifest` is host-authored metadata for plugins already included in the frontend build. IntelliJ descriptors can later be analyzed and translated into an explicit supported subset.

## API subsystem support matrix

“Browser-native” means WebBrains can implement the concept directly with browser-compatible code. “Shim/adaptation” means a targeted compatibility layer can translate a useful subset. “Deferred” means the concept is implementable but should wait for lower-level contracts. “Unsupported” means the original contract depends on facilities unavailable in a static browser runtime; a different product contract would be needed.

| Subsystem | Initial disposition | Browser feasibility, dependencies, and limits |
|---|---|---|
| Plugin descriptors and module dependencies | **Shim/adaptation** | Read descriptor metadata offline/build-time and translate an allowlisted subset into host-authored manifests. Current `PluginCatalog` validates declared plugin and platform-module dependencies and gives dependency-first order. Static bundling means descriptors cannot discover and load arbitrary JARs at runtime; IntelliJ extension class names and version constraints need explicit mapping. |
| Application, project, and module services | **Browser-native** | Scoped TypeScript service containers fit application/project/module lifetimes. Current services are in-memory and host-registered. Extension construction, service overrides, lazy initialization, and upstream service lookup rules remain to be specified. |
| Disposables and lifetimes | **Browser-native** | Deterministic explicit disposal works in JavaScript and is preferable to relying on garbage collection. Current scopes dispose once in reverse registration order and support parent-owned subscriptions. It does not yet reproduce every `Disposable`/`Disposer` edge case. |
| Message bus and topics | **Browser-native** | Typed in-process synchronous topics are straightforward and currently implemented. Cross-worker delivery, modality, message ordering across asynchronous tasks, and every upstream topic contract require separate adapters. |
| Extension points and extensions | **Shim/adaptation** | Typed registries work for frontend-compiled extensions. Current registry is in-memory. Descriptor declarations may be translated only where the extension interface has a browser implementation; arbitrary class-name instantiation is unavailable. |
| Actions, action system, and keymaps | **Shim/adaptation** | Action registration, presentation updates, dispatch, and key strokes can map to browser controls and DOM keyboard events. The host must define focus, reserved browser shortcuts, accessibility, context, and keymap conflict behavior. Swing action UI and every IntelliJ action context are not implied. |
| Projects and modules | **Browser-native** | Logical project/module objects and ownership are in-memory. They can model source roots, content roots, and dependency metadata later. They do not represent an IntelliJ installation or automatically discover host files. |
| VFS and filesystems | **Shim/adaptation** | An in-memory VFS is implemented; the File System Access API, drag/drop, and uploaded archives can be adapters subject to browser permissions and host support. Browser sandboxing prevents transparent access to arbitrary disk paths, symlinks, mounts, and OS file notifications. |
| Documents and editing | **Browser-native** | A versioned text document with range edits and synchronous notifications is implemented. Undo/redo, guarded blocks, injected documents, bulk updates, line separators, and exact IntelliJ event semantics are future work. |
| Editor, caret, and selection | **Browser-native** | Minimal caret/selection state is implemented independently of rendering. A production editor view, multi-caret behavior, visual columns, folding, inlays, soft wraps, and editor event contracts remain unimplemented. |
| PSI, trees, and element types | **Shim/adaptation** | TypeScript tree nodes, element types, ranges, and language ownership are feasible. The current source defines interfaces only. PSI invalidation, equivalence, stubs, references, AST loading, and modification tracking need a coherent document-to-tree model. |
| Lexer and parser | **Shim/adaptation** | Lexer/parser implementations can be ported or generated as JavaScript/TypeScript and consume WebBrains token/tree contracts. Current language abstractions expose a lexer boundary only. Generated IntelliJ Java code cannot run just because its algorithms are understood; parser builders and token types need adapters. |
| Indexes and stubs | **Deferred** | Browser workers and IndexedDB can hold project-local indexes; PSI/stub contracts and invalidation must come first. Quotas, eviction, schema migration, large workspaces, and cross-tab consistency shape the design. IntelliJ index formats are not assumed reusable. |
| Inspections, annotators, and highlighting | **Shim/adaptation** | Diagnostics and ranges can be represented natively and rendered by a browser editor. Requires PSI or syntax services, a stable diagnostic model, cancellation, and rendering integration. Daemon scheduling and exact severities/pass ordering are not yet supported. |
| Completion and lookup | **Deferred** | Async browser completion is practical after editor, PSI, cancellation, and document-version contracts stabilize. Lookup UI can be browser-native; matching upstream insertion handlers, document commits, and contributor ordering is a substantial compatibility task. |
| Navigation and usages | **Deferred** | Symbol indexes and PSI references can support navigation within granted project files. Requires stable identity, indexes, and search limits. OS-wide search and IDE-wide project discovery are outside the browser sandbox. |
| Refactoring | **Deferred** | Workspace edits can be planned as version-checked document changes and applied with undo support. Requires PSI references, indexes, conflict detection, multi-file transactions, and persistence. No safe general refactoring contract exists yet. |
| Intentions and quick fixes | **Deferred** | Browser actions can present code fixes and apply document edits. Requires diagnostics, editor context, range/version validation, and an undo model. IntelliJ intention discovery and preview behavior are not currently implemented. |
| Code formatting | **Deferred** | Formatters can be pure TypeScript or compiled browser modules. Requires language-specific syntax trees and document edit contracts. Exact platform formatter settings and plugin formatter execution are not available. |
| Run/debug configurations and processes | **Unsupported** for local process APIs; **shim/adaptation** for browser tasks | Browser Web APIs can support explicit web workers, WebAssembly modules, or remote endpoints when the user configures them. A static site cannot spawn arbitrary local OS processes, attach a native debugger, or provide a general JVM process API. Remote execution would be a separately secured service and is outside the current no-backend design. |
| Tool windows and notifications | **Shim/adaptation** | React panels, status areas, and browser notifications can provide equivalent user tasks. Browser permission, focus, and notification rules differ from Swing and IntelliJ window management. |
| Settings and persistence | **Browser-native** | Typed settings can use memory, IndexedDB, or browser storage. Persistence must be explicit, versioned, quota-aware, and scoped by origin. It cannot silently read or write IntelliJ config directories. |
| Background tasks, progress, and cancellation | **Browser-native** | Promises, `AbortSignal`, and Web Workers cover cooperative tasks and progress reporting. CPU-heavy work needs workers; cancellation is cooperative and cannot forcibly stop arbitrary synchronous code on the UI thread. |
| Read/write actions and concurrency | **Shim/adaptation** | A serialized async read/write coordinator or worker ownership model can protect shared document/index state. Java thread locks, read-action nesting, modality, and blocking semantics do not map directly to a single-threaded browser UI. Never block the UI thread to imitate them. |
| UI, Swing, and AWT | **Unsupported** for Swing/AWT; **shim/adaptation** for UI intent | React and DOM components can reproduce user-facing workflows behind WebBrains UI interfaces. Swing/AWT widgets, graphics contexts, native menus, and look-and-feel cannot execute in a browser. Port each UI contribution rather than emulating desktop widgets. |
| Filesystem, process, and network APIs | **Unsupported** for unrestricted filesystem/process access; **shim/adaptation** for permitted browser APIs | Fetch, WebSocket, browser storage, workers, and user-granted file handles are available within browser policy. CORS, secure-context, permission, CSP, and host-header rules apply. Java sockets, arbitrary files, environment variables, and process APIs are unavailable. |
| Language injection | **Deferred** | Embedded languages can be modeled as mapped ranges/documents after PSI and editor range mapping stabilize. Requires host/guest edit synchronization, nested diagnostics, and language-specific parsers; no current injection runtime exists. |
| Testing APIs | **Shim/adaptation** | Node built-in tests cover pure TypeScript platform contracts today; browser integration can use browser automation when available. IntelliJ fixtures, light project environments, plugin test classpaths, and headless Swing tests are not compatible without reimplementation. |

## Implemented foundation

`frontend/src/platform/` currently contains composable TypeScript modules for:

- disposable scopes and lifetime-bound subscriptions;
- typed service keys and scoped service containers;
- typed in-process message topics and connections;
- typed extension points and a disposable extension registry;
- a metadata-only catalog for host-bundled browser plugins and dependency validation;
- action registration, presentation updates, dispatch, and key bindings;
- project/module ownership, a memory VFS, versioned documents, caret/selection state, and language/PSI interfaces.

These are deliberately small contracts for WebBrains code and future adapters. Similarity of API shape does not mean IntelliJ behavioral compatibility. Current automated coverage focuses on actual lifecycle, event subscription, registry, document, and model semantics.

## Initial milestone order

1. **Stabilize the browser platform kernel**: document and test disposal, service ownership, message delivery, extension/action registration, project/module ownership, document edits, and VFS path behavior. Keep the foundation independent of React.
2. **Define plugin metadata translation**: inventory real descriptors and module dependencies, then translate only metadata that can be statically bundled. Report unsupported declarations rather than silently ignoring them. Do not execute plugin JARs.
3. **Add editor-facing language slice**: settle token/range/document version contracts; implement one language lexer and a small parser adapter; connect syntax diagnostics to the existing app deliberately without replacing its UI wholesale.
4. **Add PSI and diagnostics contracts**: define node validity, traversal, references, diagnostics, and document-change invalidation. Add conformance tests before implementing inspections.
5. **Add browser workspace persistence and workers**: explicit file permission flows, IndexedDB-backed project state, cancellation, and worker boundaries, with static-host constraints documented.
6. **Expand language services selectively**: completion, navigation, formatting, inspections, and fixes only after their dependencies are stable; measure each API family against upstream behavior.

At each milestone, record the supported API subset and known deviations. A ported API surface should be called compatible only after tests cover the behaviors that consumers rely on.

## Risks and boundaries

- IntelliJ APIs are broad, versioned, and coupled; a descriptor's declared platform dependencies often exceed the part of a plugin used by one feature.
- API names can create false confidence. Separate adaptation wrappers from browser-native contracts and test semantics rather than relying on naming resemblance.
- Dynamic class loading, reflection-heavy extension discovery, arbitrary JVM bytecode, and native libraries are not supplied by this architecture. Compiling selected code to another target would still require compatible APIs and is not part of this step.
- Browser file access, storage quotas, workers, cross-origin isolation, CSP, and permissions vary by deployment host and browser.
- PSI/index invalidation, cancellation, large workspaces, multi-file edits, and UI responsiveness are correctness concerns, not later polish.
- The supplied Python Community Edition experiment demonstrates that even its parser depends on IntelliJ types and services. It is evidence for dependency analysis, not evidence that its JARs run in WebBrains.
