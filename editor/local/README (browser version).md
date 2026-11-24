# Starforge, browser version (no Java needed)

1. Open **Open Starforge.html** in **Chrome** or **Edge** (or Opera, Vivaldi, Brave with its file-system setting on).
   If another browser opens it, right-click the file → Open with → Chrome.
2. Click **Choose folder…** and pick your Starsector folder: the one that contains `starsector-core` and `mods`
   (macOS: the folder containing `Starsector.app`; Linux: the folder with `starsector.sh`).
3. Allow the browser to view and edit files in it. The editor reads the game and every mod, and writes only inside `mods`.

Next time, click **Continue with this folder** (the browser may ask for permission again).

**Doesn't work with:**
- **Firefox and Safari.** They can't give a page access to a folder. Use the Java version (`Start Starforge.bat`) instead.
- **Starsector inside `Program Files`.** Chrome protects that folder, and it's where the Windows installer puts the game
  by default. Use the Java version, or copy or move the whole Starsector folder somewhere else (for example
  `C:\Games\Starsector`) and point the editor there.

**Differences from the Java version:**
- Files open read-only in a new tab instead of in your text editor, and there's no "Show in folder".
- Backups go to `mods\starforge-backups\` (one folder per Save all; the game ignores it).
- Settings and the remembered folder are kept by the browser, not in files next to the editor.

Everything else is the same editor. See README.md in the Starforge folder for the full guide.
