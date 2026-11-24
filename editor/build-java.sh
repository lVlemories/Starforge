#!/bin/sh
# Starforge: builds starforge.jar (Java version) from src/ and web/. Needs a JDK 11+ (javac, jar).
# Copyright (C) 2026 Claude. SPDX-License-Identifier: GPL-3.0-or-later
set -e
cd "$(dirname "$0")"
rm -rf build && mkdir -p build/web
javac --release 11 -nowarn -d build src/forge/*.java
cp web/* build/web/
if [ -f LICENSE ]; then cp LICENSE build/LICENSE; else cp ../LICENSE build/LICENSE; fi
(cd build && jar cfm ../starforge.jar ../manifest.txt .)
echo "Built starforge.jar"
