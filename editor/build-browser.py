#!/usr/bin/env python3
# Starforge: a Starsector ship, weapon and mod editor.
# Copyright (C) 2026 Claude
# SPDX-License-Identifier: GPL-3.0-or-later
# This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
# License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
# version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"""Builds the no-Java browser version: build-browser/Starforge (browser)/Open Starforge.html + app/."""
import base64, os, re, shutil, sys
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "build-browser", "Starforge (browser)")
app = os.path.join(out, "app")
shutil.rmtree(os.path.join(here, "build-browser"), ignore_errors=True)
os.makedirs(app)
web, local = os.path.join(here, "web"), os.path.join(here, "local")
for f in ["app.css", "app.js", "editors.js", "features.js", "sim.js", "changes.js", "tools.js"]:
    shutil.copy(os.path.join(web, f), app)
for f in ["local-core.js", "local-data.js", "local-api.js", "local-assets.js", "local-ui.js"]:
    shutil.copy(os.path.join(local, f), app)
# images the editor draws into canvases must be data: URLs (file:// images would make canvases unreadable)
static = {}
for f in ["engineflame32.png", "engineflamecore32.png"]:
    static[f] = "data:image/png;base64," + base64.b64encode(open(os.path.join(web, f), "rb").read()).decode()
with open(os.path.join(app, "local-static.js"), "w") as fh:
    fh.write('"use strict";\nwindow.FORGE_STATIC = {\n' + ",\n".join(f'  "{k}": "{v}"' for k, v in static.items()) + "\n};\n")
html = open(os.path.join(web, "index.html"), encoding="utf-8").read()
html = html.replace('href="/web/', 'href="app/')
pre = "".join(f'<script src="app/{f}"></script>\n' for f in ["local-static.js", "local-core.js", "local-data.js", "local-api.js", "local-assets.js"])
html = html.replace('<script src="/web/app.js"></script>', pre + '<script src="app/app.js"></script>', 1)
html = html.replace('<script src="/web/tools.js"></script>', '<script src="app/tools.js"></script>\n<script src="app/local-ui.js"></script>', 1)
html = html.replace('src="/web/', 'src="app/')
csp = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; "
       "connect-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'")
if len(sys.argv) > 1 and sys.argv[1] == "--test":  # the test harness talks to a local file server
    csp = csp.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:*")
html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="{csp}">', 1)
html = re.sub(r"<title>.*?</title>", "<title>Starforge (browser)</title>", html, count=1)
assert "/web/" not in html, "leftover /web/ reference"
open(os.path.join(out, "Open Starforge.html"), "w", encoding="utf-8").write(html)
shutil.copy(os.path.join(local, "README (browser version).md"), out)
lic = os.path.join(here, "LICENSE")
shutil.copy(lic if os.path.exists(lic) else os.path.join(here, "..", "LICENSE"), out)
print("built", out)
