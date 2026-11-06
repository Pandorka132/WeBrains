from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "build_plugins.py"
SPEC = importlib.util.spec_from_file_location("build_plugins", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class BuildPluginsTests(unittest.TestCase):
    def test_discovers_only_zip_archives_at_input_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sample.zip").write_bytes(b"placeholder")
            self.assertEqual([path.name for path in module.plugin_archives(root)], ["sample.zip"])

    def test_rejects_extracted_plugin_folders(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sample-plugin").mkdir()
            with self.assertRaisesRegex(RuntimeError, "only plugin .zip files"):
                module.plugin_archives(root)

    def test_batch_profiles_require_explicit_opt_in(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            original = module.PROFILE_ROOT
            try:
                module.PROFILE_ROOT = Path(temporary)
                (module.PROFILE_ROOT / "enabled.json").write_text(
                    '{"pluginId":"sample.plugin","batchEnabled":true}', encoding="utf-8"
                )
                (module.PROFILE_ROOT / "disabled.json").write_text(
                    '{"pluginId":"sample.plugin"}', encoding="utf-8"
                )
                self.assertEqual(
                    [path.name for path in module.profiles_for("sample.plugin")],
                    ["enabled.json"],
                )
            finally:
                module.PROFILE_ROOT = original

    def test_frontend_profiles_require_explicit_frontend_opt_in(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            production = root / "production.json"
            experimental = root / "experimental.json"
            production.write_text('{"frontendEnabled":true}', encoding="utf-8")
            experimental.write_text('{"frontendEnabled":false}', encoding="utf-8")
            self.assertEqual(module.frontend_profiles([production, experimental]), [production])

    def test_build_output_requires_a_successful_runtime_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "plugin" / "1.0" / "run-1"
            reports = output / "reports"
            reports.mkdir(parents=True)
            (reports / "plugin-inventory.json").write_text(
                json.dumps({"status": "BUILD_AND_RUNTIME_TEST_PASSED", "outputDirectory": str(output)}),
                encoding="utf-8",
            )
            self.assertEqual(module.build_output_for(root), output)
            (reports / "plugin-inventory.json").write_text(
                json.dumps({"status": "BUILD_FAILED", "outputDirectory": str(output)}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "not successful"):
                module.build_output_for(root)

    def test_installs_only_assets_from_frontend_enabled_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original_root = module.ROOT
            try:
                module.ROOT = root
                profile = root / "lexer.json"
                profile.write_text(json.dumps({
                    "imageName": "python-ce-lexer",
                    "browserApi": True,
                    "browserWorkerName": "python-ce-lexer.worker.js",
                }), encoding="utf-8")
                web = root / "build" / "web"
                web.mkdir(parents=True)
                for asset in ("python-ce-lexer.js", "python-ce-lexer.js.wasm", "python-ce-lexer.worker.js"):
                    (web / asset).write_text(asset, encoding="utf-8")
                module.install_frontend_capabilities([profile], {profile: web.parent}, "PythonCore")
                installed = root / "frontend/public/plugins/pythoncore"
                self.assertEqual(
                    sorted(path.name for path in installed.iterdir()),
                    ["python-ce-lexer.js", "python-ce-lexer.js.wasm", "python-ce-lexer.worker.js"],
                )
            finally:
                module.ROOT = original_root

    def test_manifest_rejects_plugin_ids_that_escape_the_output_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original_root = module.ROOT
            try:
                module.ROOT = root
                with self.assertRaisesRegex(RuntimeError, "cannot be used safely"):
                    module.write_frontend_manifest(
                        root / "sample.zip",
                        {"id": "../outside", "name": "Outside", "version": "1"},
                        [],
                        module.load_plugin_builder(),
                    )
                self.assertFalse((root / "frontend").exists())
            finally:
                module.ROOT = original_root

    def test_manifest_reads_descriptor_and_icon_from_nested_jar(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original_root = module.ROOT
            try:
                module.ROOT = root
                archive = root / "sample.zip"
                jar_bytes_path = root / "sample.jar"
                with zipfile.ZipFile(jar_bytes_path, "w") as jar:
                    jar.writestr(
                        "META-INF/plugin.xml",
                        "<idea-plugin><id>sample.plugin</id><name>Sample</name><version>1</version>"
                        "<description><![CDATA[Sample <b>plugin</b> description.]]></description>"
                        "<vendor>Example Vendor</vendor></idea-plugin>",
                    )
                    jar.writestr("META-INF/pluginIcon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>")
                with zipfile.ZipFile(archive, "w") as outer:
                    outer.write(jar_bytes_path, "lib/sample.jar")

                manifest_path = module.write_frontend_manifest(
                    archive,
                    {"id": "sample.plugin", "name": "Sample", "version": "1"},
                    [],
                    module.load_plugin_builder(),
                )
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                self.assertEqual(manifest["description"], "Sample plugin description.")
                self.assertEqual(manifest["vendor"], "Example Vendor")
                self.assertEqual(manifest["icon"], "plugins/sample.plugin/plugin-icon.svg")
                self.assertTrue((root / "frontend/public" / manifest["icon"]).is_file())
            finally:
                module.ROOT = original_root


if __name__ == "__main__":
    unittest.main()
