#!/bin/sh
# Starts Starforge on Linux or macOS:  sh start-starforge.sh
# The editor finds your Starsector folder by itself (or asks once in the browser and remembers it in
# starsector-path.txt), so this folder can live anywhere.
cd "$(dirname "$0")" || exit 1
# Java needs a UTF-8 locale to open mod folders with non-English characters in their names
case "${LC_ALL}${LC_CTYPE}${LANG}" in *UTF-8*|*utf-8*|*UTF8*|*utf8*) ;; *) export LC_ALL=C.UTF-8 ;; esac
GAME=..
# keeping this folder somewhere else? put the Starsector folder's path in starsector-path.txt
[ -f starsector-path.txt ] && GAME="$(head -n 1 starsector-path.txt | tr -d '\r')"
JAVA=""
for j in "$GAME"/jdk-*/bin/java "$GAME"/jre_linux/bin/java "$GAME"/jre/bin/java "$GAME"/Starsector.app/Contents/Home/bin/java \
         "$HOME"/starsector/jre_linux/bin/java "$HOME"/Games/starsector/jre_linux/bin/java /opt/starsector/jre_linux/bin/java; do
  if [ -x "$j" ]; then JAVA="$j"; break; fi
done
if [ -z "$JAVA" ]; then
  if command -v java >/dev/null 2>&1; then JAVA=java
  else echo "No Java found. Install Java 11 or newer (e.g. from adoptium.net), then run this again."; exit 1; fi
fi
echo "Using $JAVA (needs Java 11 or newer)"
exec "$JAVA" -jar starforge.jar "$GAME" 8765
