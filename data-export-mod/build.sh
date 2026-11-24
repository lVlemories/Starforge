#!/bin/sh
# Starforge Data Export: builds jars/forge_data_export.jar. Needs a JDK (javac, jar) and a Starsector install for its API jars.
# Usage: sh build.sh /path/to/Starsector     (the folder containing starsector-core)
# Copyright (C) 2026 Claude. SPDX-License-Identifier: GPL-3.0-or-later
set -e
cd "$(dirname "$0")"
GAME="${1:?Usage: sh build.sh /path/to/Starsector}"
CORE="$GAME/starsector-core"; [ -d "$CORE" ] || CORE="$GAME"
CP="$CORE/starfarer.api.jar:$CORE/log4j-1.2.9.jar:$CORE/json.jar"
rm -rf build && mkdir -p build jars
javac --release 8 -nowarn -cp "$CP" -d build src/forgeexport/*.java
(cd build && jar cf ../jars/forge_data_export.jar .)
echo "Built jars/forge_data_export.jar. Copy mod_info.json and jars/ into mods/Starforge Data Export/."
