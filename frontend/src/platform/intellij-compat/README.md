# IntelliJ Platform compatibility layer

This directory is the boundary for future implementations of the IntelliJ Platform APIs
used by unmodified plugins. It intentionally contains no fake or partial API shims yet.

The current `platform/core` APIs are WebBrains-native abstractions, not binary-compatible
implementations of IntelliJ classes. Add compatibility types here only when their required
semantics and the target plugin's actual dependencies have been verified.
