from __future__ import annotations

import argparse
import importlib.util
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "plugin_web_build.py"
SPEC = importlib.util.spec_from_file_location("plugin_web_build", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class BrowserWrapperTests(unittest.TestCase):
    def test_adapts_generated_wrapper_for_one_browser_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            wrapper = Path(temporary) / "python-ce-lexer.js"
            wrapper.write_text(
                "function load_cmd_args() {\n    return [];\n}\n\n"
                "async function wasmInstantiate(config, args) {\n"
                "    const wasmPath = config.wasm_path || runtime.getCurrentFile() + \\\".wasm\\\";\n"
                "    const file = await runtime.fetchData(wasmPath);\n"
                "    const result = await WebAssembly.instantiate(file, wasmImports);\n"
                "    return { instance: result.instance, memory: result.instance.exports.memory };\n"
                "}\n\n"
                "const config = new GraalVM.Config();\n"
                "GraalVM.run(load_cmd_args(),config).catch(e => { console.error(e); throw e; });\n"
                "})();",
                encoding="utf-8",
            )
            module.adapt_browser_wrapper(wrapper)
            generated = wrapper.read_text(encoding="utf-8")

        self.assertIn("globalThis.__pythonCeStart = (source) =>", generated)
        self.assertIn("GraalVM.run([source], config)", generated)
        self.assertIn("globalThis.__pythonCeWasmModule instanceof WebAssembly.Module", generated)
        self.assertIn("WebAssembly.instantiate(globalThis.__pythonCeWasmModule, wasmImports)", generated)
        self.assertIn('type: "complete"', generated)
        self.assertIn('typeof document === "undefined"', generated)


class PluginInspectionTests(unittest.TestCase):
    def make_plugin_archive(self, destination: Path, plugin_id: str = "sample.plugin") -> Path:
        descriptor = f'''<idea-plugin><id>{plugin_id}</id><name>Sample Plugin</name><version>1.2.3</version><idea-version since-build="241" until-build="242.*"/><depends>com.intellij.modules.platform</depends><depends optional="true">org.example.optional</depends></idea-plugin>'''.encode()
        nested_buffer = io.BytesIO()
        with zipfile.ZipFile(nested_buffer, "w") as nested:
            nested.writestr("META-INF/plugin.xml", descriptor)
        with zipfile.ZipFile(destination, "w") as outer:
            outer.writestr("sample/lib/sample.jar", nested_buffer.getvalue())
            outer.writestr("sample/readme.txt", "fixture")
        return destination

    def test_reads_plugin_descriptor_from_nested_jar(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = self.make_plugin_archive(Path(temporary) / "plugin.zip")
            result = module.inspect_plugin(archive)
        plugin = result["primaryPlugin"]
        self.assertEqual(plugin["id"], "sample.plugin")
        self.assertEqual(plugin["version"], "1.2.3")
        self.assertEqual(plugin["sinceBuild"], "241")
        self.assertEqual(plugin["untilBuild"], "242.*")
        self.assertEqual(plugin["dependencies"], [
            {"id": "com.intellij.modules.platform", "optional": False},
            {"id": "org.example.optional", "optional": True},
        ])
        self.assertEqual(result["nestedArchiveCount"], 1)
        self.assertEqual(result["nonArchiveFileCount"], 1)
        self.assertEqual(len(result["archiveSha256"]), 64)

    def test_rejects_archive_without_plugin_descriptor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "not-a-plugin.zip"
            with zipfile.ZipFile(archive, "w") as outer:
                outer.writestr("README.txt", "not a plugin")
            with self.assertRaises(module.BuildError):
                module.inspect_plugin(archive)

    def test_archive_path_safety_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "plugin.zip"
            nested_buffer = io.BytesIO()
            with zipfile.ZipFile(nested_buffer, "w") as nested:
                nested.writestr("META-INF/plugin.xml", b"<idea-plugin><id>x</id><name>X</name></idea-plugin>")
            with zipfile.ZipFile(archive, "w") as outer:
                outer.writestr("../escape.jar", nested_buffer.getvalue())
            with self.assertRaises(module.BuildError):
                module.extract_plugin_jars(archive, Path(temporary) / "out", ["*.jar"])

    def test_unknown_plugin_generates_inventory_without_fake_wasm(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = self.make_plugin_archive(Path(temporary) / "plugin.zip", "unknown.plugin")
            output_root = Path(temporary) / "generated"
            args = argparse.Namespace(
                plugin=str(archive), profile=None, output_root=str(output_root),
                inspect_only=False, web_image=None, javac=None, jdk=None, node=None,
            )
            self.assertEqual(module.build(args), 3)
            runs = list(output_root.glob("unknown.plugin/1.2.3/run-*/reports"))
            self.assertEqual(len(runs), 1)
            report = json.loads((runs[0] / "plugin-inventory.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "BLOCKED_NO_PROFILE")
            self.assertTrue((runs[0] / "BUILD_BLOCKED.md").is_file())
            self.assertFalse((runs[0].parent / "web").exists())


if __name__ == "__main__":
    unittest.main()
