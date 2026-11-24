#!/usr/bin/env python3
# Starforge: builds the downloadable zips for a GitHub release into dist/.
# Copyright (C) 2026 Claude. SPDX-License-Identifier: GPL-3.0-or-later
#
# Usage: python3 make-release.py 1.0.0 [path/to/Starsector]
#   Needs a JDK 11+ (javac, jar). The Starsector path is only needed to rebuild the Data Export mod;
#   without it, an already built data-export-mod/jars/forge_data_export.jar is used if present.
import os, shutil, subprocess, sys, zipfile

here = os.path.dirname(os.path.abspath(__file__))
version = sys.argv[1] if len(sys.argv) > 1 else "dev"
game = sys.argv[2] if len(sys.argv) > 2 else None
ed, mod, dist = os.path.join(here, "editor"), os.path.join(here, "data-export-mod"), os.path.join(here, "dist")
shutil.rmtree(dist, ignore_errors=True)
os.makedirs(dist)
win = os.name == "nt"

def run(cmd, cwd):
    print("+", " ".join(cmd))
    subprocess.check_call(cmd, cwd=cwd)

run(["cmd", "/c", "build-java.bat"] if win else ["sh", "build-java.sh"], ed)
run([sys.executable, "build-browser.py"], ed)
if game:
    run(["cmd", "/c", "build.bat", game] if win else ["sh", "build.sh", game], mod)

def zipdir(zpath, items):
    """items: (source path, path inside the zip). Folders are added recursively."""
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for src, arc in items:
            if os.path.isdir(src):
                for root, _, files in os.walk(src):
                    for f in sorted(files):
                        p = os.path.join(root, f)
                        z.write(p, os.path.join(arc, os.path.relpath(p, src)).replace("\\", "/"))
            else:
                z.write(src, arc)
    print("wrote", os.path.relpath(zpath, here), f"({os.path.getsize(zpath) // 1024} KB)")

browser = os.path.join(ed, "build-browser", "Starforge (browser)")
lic, guide = os.path.join(here, "LICENSE"), os.path.join(here, "docs", "GUIDE.md")
# everything: Java version + browser version
zipdir(os.path.join(dist, f"Starforge-{version}.zip"), [
    (os.path.join(ed, "starforge.jar"), "Starforge/starforge.jar"),
    (os.path.join(ed, "Start Starforge.bat"), "Starforge/Start Starforge.bat"),
    (os.path.join(ed, "start-starforge.sh"), "Starforge/start-starforge.sh"),
    (guide, "Starforge/README.md"), (lic, "Starforge/LICENSE"),
    (browser, "Starforge/Starforge (browser)"),
])
# browser version on its own (no Java needed)
zipdir(os.path.join(dist, f"Starforge-browser-{version}.zip"), [(browser, "Starforge (browser)")])
# optional companion mod
jar = os.path.join(mod, "jars", "forge_data_export.jar")
if os.path.exists(jar):
    zipdir(os.path.join(dist, f"Starforge-Data-Export-{version}.zip"), [
        (os.path.join(mod, "mod_info.json"), "Starforge Data Export/mod_info.json"),
        (jar, "Starforge Data Export/jars/forge_data_export.jar"), (lic, "Starforge Data Export/LICENSE"),
    ])
else:
    print("skipped the Data Export mod zip (pass your Starsector folder to build it)")
