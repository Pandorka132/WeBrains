#!/usr/bin/env python3
"""List Python plugin JARs and locate lexer/parser-related classes."""
import io
import zipfile
from pathlib import Path

archive = Path(__file__).resolve().parent / "python-ce-263.7031.23.zip"
needles = ("Lexer", "Parser", "SyntaxHighlighter", "FileType", "Annotator", "TokenType", "PsiParser", "PyTokenTypes", "PythonLexer", "PythonParser")
with zipfile.ZipFile(archive) as distribution:
    jars = [name for name in distribution.namelist() if name.startswith("python-ce/lib/") and name.endswith(".jar")]
    print("JAR inventory:")
    for name in jars:
        print(f"{distribution.getinfo(name).file_size:>10}  {name}")
    print("\nRelevant classes in module jars:")
    for name in jars:
        with zipfile.ZipFile(io.BytesIO(distribution.read(name))) as jar:
            hits = [entry for entry in jar.namelist() if entry.endswith(".class") and any(needle.lower() in entry.lower() for needle in needles)]
        if hits:
            print(f"\n{name}")
            for hit in hits[:40]:
                print(f"  {hit}")
            if len(hits) > 40:
                print(f"  ... and {len(hits) - 40} more")
