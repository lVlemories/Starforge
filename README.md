# Starforge

A standalone ship, weapon and mod editor for **Starsector**. It loads the game and all your mods, lets you edit them
visually, and saves only into your mods folder.

- **Ships:** weapon slots, engines, bounds, collision and shield centres, variants, built-in weapons, hullmods and wings,
  skins, station modules, OP budget and stats.
- **Weapons:** CSV stats, `.wpn` and `.proj` files, sprites, sounds, and a firing preview for checking animations.
- **Strike craft, hullmods and ship systems:** CSV editors with descriptions.
- **Getting it into the game:** faction "known" lists, fleet roles and blueprint tags.
- **Safe saving:** every change goes into a reviewable Changes list with a diff, and every file is backed up before
  it's overwritten.
- **Mods:** choose which mods to load, filter lists by mod, see where any item is used, and export a mod as a zip.

## Download

Get the latest zip from the [Releases](../../releases) page:

| File | What it is |
|---|---|
| `Starforge-x.y.z.zip` | Everything: the Java version and the browser version |
| `Starforge-browser-x.y.z.zip` | Browser only version (No Java needed) |
| `Starforge-Data-Export-x.y.z.zip` | Optional companion mod that shows the real numbers in hullmod descriptions |

## Quick start

Unzip `Starforge-x.y.z.zip` anywhere (inside your Starsector folder is easiest, e.g. `Starsector\Starforge`).

### Java version (any browser, including Firefox)
1. Double-click **`Start Starforge.bat`** (Linux/macOS: `sh start-starforge.sh`).
2. Your browser opens the editor. It uses the Java that comes with Starsector, so there's nothing to install.
3. It finds your Starsector folder by itself. If it can't, it asks you once and remembers the answer.

### Browser version (Chrome, Edge or another Chromium browser; no Java)
1. Open **`Starforge (browser)\Open Starforge.html`** in Chrome or Edge.
2. Click **Choose folder…**, pick your Starsector folder (the one containing `starsector-core` and `mods`), and allow access.
3. Next time, click **Continue with this folder**.

The browser version doesn't work in Firefox or Safari. It also can't open a Starsector install inside `Program Files`,
because Chrome blocks that folder. In either case, use the Java version.

### First steps
- Click **? Guide** in the top right for a walkthrough. Hover over any underlined field name for help.
- Pick the mod to save into in **Save to mod** (or create one with **New mod…**).
- Edit a ship, weapon or strike craft, then open **Changes** and click **Save all**.
- Restart Starsector to see the changes in game.

### Hullmod description numbers (optional)
Hullmod descriptions contain values such as "%s armor" that only the game can work out. To see the real numbers:
1. Unzip `Starforge-Data-Export-x.y.z.zip` into `Starsector\mods`.
2. Enable **Starforge Data Export** in the launcher and start the game once.
3. Reload Starforge.

The mod adds nothing to gameplay and can be turned on or off at any time.

## Safety
- Starforge only writes inside your `mods` folder. The base game is never changed.
- Every save is backed up first, and **Backups…** can restore any earlier save.
- The Java version listens only on your own computer and answers only the browser tab it opened. The browser version
  runs no server at all.

## Building from source
- **Java version:** run `editor/build-java.bat` (or `sh editor/build-java.sh`). It needs a JDK 11+ and creates `editor/starforge.jar`.
- **Browser version:** run `python3 editor/build-browser.py`. It creates `editor/build-browser/Starforge (browser)/`.
- **Data Export mod:** run `data-export-mod/build.bat "path\to\Starsector"`. It needs a JDK and your Starsector install
  for its API jars.
- **Release zips:** run `python3 make-release.py 1.0.0 "path/to/Starsector"`, which puts the zips in `dist/`.

| Folder | Contents |
|---|---|
| `editor/web/` | The editor UI (HTML, CSS, JavaScript), shared by both versions |
| `editor/src/forge/` | The Java version's local server: loading, merging, saving, backups |
| `editor/local/` | The browser version's in-page replacement for the Java server |
| `data-export-mod/` | The optional companion mod |
| `docs/GUIDE.md` | Full user guide |

## Licence
Starforge is free software under the **GNU General Public License v3.0 or later**; see [LICENSE](LICENSE).
You may use, share and modify it. Modified versions you distribute must stay under the GPL, with their source available.

## Credits
- Written by Claude (Anthropic).
- Engine flame textures from [Ship-Editor](https://github.com/Ontheheavens/Ship-Editor) by Ontheheavens (public domain),
  which also inspired the engine and slot editing.
- Starsector is © Fractal Softworks. Starforge contains no game files; it reads them from your own install.
