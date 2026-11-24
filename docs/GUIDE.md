# Starforge: standalone Starsector ship editor

There are two versions with the same editor inside. Use whichever suits you:

| | **Java version** | **Browser version** (folder `Starforge (browser)`) |
|---|---|---|
| Start | Double-click **Start Starforge.bat** | Open **Open Starforge.html** in Chrome or Edge |
| Needs | Java 11+ (Starsector's own `jre` is used automatically) | Chrome, Edge, Opera, Vivaldi or another Chromium browser |
| Browsers | Any, including Firefox | Not Firefox or Safari (they can't open folders) |
| Starsector in `Program Files` | Works | Doesn't work: Chrome blocks that folder (copy or move the game first) |
| Opening files | In your text editor / Explorer | Read-only view in a new tab |
| Backups | `Starforge\backups\` | `mods\starforge-backups\` (the game ignores it) |

Both read the game and all mods, write only inside `mods`, and back up every file before saving.

**Java version:** double-click **Start Starforge.bat**. It opens in your browser. If port 8765 is busy it uses the
next free one, and if the editor is already running it opens that instead.

**Browser version:** open `Starforge (browser)\Open Starforge.html` (right-click → Open with → Chrome or Edge if
another browser is your default). The first time, click **Choose folder…** and pick your Starsector folder (the one with
`starsector-core` and `mods` in it), then allow the browser to view and edit files there. The page remembers the
folder; on later visits click **Continue with this folder** and allow access again if the browser asks.
Nothing is installed and no program runs in the background: close the tab and it's gone. It's safe to copy the
`Starforge (browser)` folder anywhere, or to share it on its own.

## Help
Click **? Guide** (top right) for a short walkthrough; it opens by itself the first time. Hover over any field
name with a dotted underline to see what it does, and over buttons for what they do.

## Loading
All installed mods are loaded by default (enabled or not). Switch to enabled-only on the
**Sources** tab, then click Reload.

## Getting new content into the game: Factions & roles
A new ship, weapon or wing only shows up in fleets, markets and blueprints if a faction **knows** it.
* Ships: **Factions & roles…** in the ship header. Tick the factions that should know it (and **Priority** to make
  their fleets prefer it), add a variant to **fleet roles** (combatSmall, carrierMedium… in
  `default_ship_roles.json`) with a weight, and pick **blueprint tags** (rare_bp, midline_bp…).
* Weapons, wings and hullmods: **Factions…** in their editor (known/priority lists and blueprint tags).
These are saved as small files in your Save-to mod (e.g. `data/world/factions/tritachyon.faction` holding only
your additions), which the game merges with the original faction. Vanilla and other mods aren't touched.
Already-known entries (including via a faction's tag list) are shown greyed out.

## Where used
**Where used** (ships, weapons, wings, hullmods, ship systems) lists every variant, hull/skin built-in, fighter wing,
station module, faction and fleet role in the loaded data that refers to it. Click a variant or hull to open it.
Java scripts aren't searched.

## Hullmods and ship systems
* **Hullmods** tab: click a hullmod to edit its `hull_mods.csv` row: name, OP cost per hull size, tags, UI tags,
  icon (with Browse…), description, short and S-mod texts. Duplicate makes a copy under a new id.
* **Systems** tab: ship systems' `ship_systems.csv` row (flux, uses, charges, timing, restrictions), description,
  and the `.system` file (sounds with ▶, engine/weapon glow colours, plus raw JSON).
The actual effects come from Java scripts, so a duplicate behaves like the original until it gets its own script.

## Exporting a mod
**⤓ Export** (next to Save to mod) downloads the Save-to mod as a .zip, ready to share; the Sources tab has a
**⤓ zip** button for every mod. Old `.bak` files are left out; unsaved changes aren't included.

## Hiding fighters in the hull list
Fighter hulls are hidden from the Ships list by default (they have their own Strike craft tab); the count shows how
many are hidden. Pick **All incl. fighters** or **FIGHTER** in the size dropdown to show them. The choice is
remembered. "Edit fighter geometry & loadout" in the Strike craft tab still opens fighters either way.

## Filtering by mod
The Ships, Weapons and Strike craft lists each have an **All mods** dropdown listing only the mods that add
something to that list, with counts. The choice is remembered.

## Image browser
Every sprite field (weapon turret/hardpoint/under/gun/glow sprites, hull and skin sprite, and the New hull /
New skin dialogs) has a **Browse…** button. It shows every image under `graphics/` in the game and all loaded
mods as thumbnails with pixel sizes, a folder tree, a search box (searches all folders by name or path) and a
mod filter. Click to select, double-click or **Use image** to fill the field; **No image** clears it. It opens
in the folder of the current image. ↻ rescans if you add files while the editor is running.

## Tabs
Each hull you pick opens in its own tab above the view. Tabs keep their own undo history, selection
and zoom. A dot means unsaved changes. Close with ✕ or middle-click.

## Creating things
* **New hull…** (top of the hull list): id, name, size, style, and a sprite, either a path to an image already
  in the game/mods or an uploaded PNG (saved into your Save-to mod). Stats start as a copy of a hull of the
  same size (or one you name). Then Generate bounds, add slots and engines.
* **Duplicate hull…** (ship header): copies hull file, stats row, description and optionally the variant
  under a new id. **New skin…** makes a `.skin` of the current hull.
* **New mod…**: creates a mod folder with `mod_info.json`, optional Version Checker files, optionally
  enables it in `enabled_mods.json` (backed up first), and selects it as the Save-to mod.

## Skins
Opening a skin shows the base hull with the skin's changes applied. Edit slots, engines, built-ins and wings
as usual; the editor writes only the differences to the `.skin` (weaponSlotChanges, removeWeaponSlots,
removeEngineSlots, engineSlotChanges, builtIn*/remove*). The skin form in View mode covers name, sprite,
description prefix, OP, fleet points, system, tags, hints and a raw JSON box. Bounds and centers come from
the base hull, so those modes are disabled for skins.

## Editing (Ships tab, modes along the top; keys 1-6)
* **View**: stats, editable description, hint toggles, geometry summary. The **checks** button in the header
  (✓ No problems / ⚠ N warnings) lists problems such as missing sprites, slots outside the sprite, unknown
  ids, weapons that don't fit, over-budget OP and module issues; click one to jump to it.
* **Variant**: click a slot (or a row in the panel) to fit a weapon. Add hullmods, S-mods,
  built-in hullmods (hull file), fighter wings, vents and capacitors, with a live OP total.
  **Built-in wings** (hull file) are listed under Fighter bays: add or remove them there.
  **Weapon groups**: set each group's mode (linked/alternating) and autofire, and move weapons between
  groups (up to 7). **Station modules**: pick a module variant for each STATION_MODULE slot (or click the
  slot twice); see Multi-part ships below.
* **Slots**: click a slot to open its editor right next to it (id, type, size, mount, angle, arc,
  position, built-in weapon). Drag to move, Alt+drag to aim, Shift+click to add, Del to delete, Esc to close.
  Launch bays can have several launch points: add, remove or drag each one.
* **Engines**: flames are drawn tinted by engine style. Click one to edit it in place. Drag, Alt+drag to aim,
  Ctrl+drag to resize, Shift+click to add.
* **Bounds**: drag points, Shift+click to insert on the nearest edge, mirror left side to right.
  **Generate bounds** traces the sprite outline: choose the point count, gap filling (joins detached
  parts), padding, alpha cutoff, convex hull and symmetric.
* **Centers**: drag the ship center (all points stay put on the sprite), shield center;
  Alt+drag sets shield radius, Shift+drag sets collision radius. For module hulls, add and drag the
  **module anchor** (where the module attaches to its parent's slot).
* **Mirror** (M) edits symmetrical slots, engines and bound points together. **Snap** rounds to 0.5 px.
* Ctrl+Z / Ctrl+Y undo and redo; Ctrl+S saves.

## Weapons tab (weapon editor)
* Every `weapon_data.csv` column, grouped (damage, firing, ammo, accuracy, projectile, tooltip text), with live
  DPS, flux/sec, flux per damage and DPS per OP.
* `.wpn` file: spec class, mount type, size, barrel mode, all sprites (with Browse…), projectile id, sounds, render hints, plus
  a raw JSON box for everything else.
* Fire points: drag on the turret or hardpoint sprite, Alt+drag to aim, Shift+click to add, Del to remove,
  optional mirror.
* Projectile `.proj` (raw JSON) and the description text.
* **Duplicate as new weapon** creates a copy under a new id (its files appear in the Changes list).

### Visual effects, projectiles and sounds
* **Visual effects & sounds (.wpn)**: glow colour, firing animation, recoil, animated frames, muzzle flash and smoke
  settings, beam colours/texture/width, and the fire sounds with ▶ to play them.
* **Projectile**: a form for the `.proj`: bullet/bolt/plasma look, sprite, length, width, colours, glow; for missiles
  the sprite, size, center, guidance (acceleration, turn rate) and engine flame, including custom colours. If the
  weapon's projectile doesn't exist yet, **Create projectile / Create missile** makes one.
* Every colour (`[r, g, b, a]`) has a colour picker, an opacity slider and editable numbers.
* Engines with the CUSTOM style get flame/contrail colour pickers in the engine popup too.

### Firing preview
Hidden by default: click **Firing preview** at the top of the weapon editor to show it (it then stays open while
you switch weapons). **It is an approximation**, mainly useful for checking a weapon's sprites and animation, not a
reproduction of the game's renderer. It fires at a target dummy using the CSV stats, `.wpn` and `.proj` exactly as
currently edited (change a value and the preview follows):
* charge-up / burst / cooldown timing, burst delay, spread growth and decay, ammo and regeneration;
* barrels (alternating, linked, alternating burst), turret or hardpoint (the Turret/Hardpoint buttons below),
  visual recoil of the gun sprite, glow sprites tinted with `glowColor`, animated frames (`numFrames`/`frameRate`);
* muzzle flash and smoke particles, ballistic shells (`bulletSprite`), beam-like shots, plasma, missiles with
  engine flames and contrails (lightly homing on the dummy), continuous and burst beams with their textures;
* a readout of shots, hits and measured DPS on the target, a close-up inset of the weapon, speed (down to 0.1×),
  zoom (slider or mouse wheel), Fit range, and a draggable target.
Tick **Sound** to hear the weapon's fire sounds (and beam loops) while it fires.
It approximates the game: scripted effects (onHit, everyFrame, beamEffect) aren't run. Changing
`projectileSpecId` loads that projectile into the editor.

## Strike craft tab (fighter editor)
* `wing_data.csv` fields (role, fighters per wing, formation, OP, refit time, ranges…) and the fighter hull's
  `ship_data.csv` stats, saved together.
* **Edit fighter geometry & loadout** opens the fighter hull in the Ships tab with the wing's variant selected.
* **Duplicate as new wing** for a new wing id.

## Ship stats
In the Ships tab's **View** mode the hull's `ship_data.csv` row is editable (Save stats or Ctrl+S).

## How CSV saves work
Only the edited row is written: it replaces the row with the same id in that mod's CSV, or is appended
(the file is created if needed). Every other line in the file stays exactly as it was, and the first save
is backed up first (see Backups). Vanilla rows go into your Save-to mod's CSV, which overrides vanilla by id.

## Colours
**⚙ Colours** (top right) changes weapon arc colour and opacity, each slot type's colour, and the bounds,
selection, centers and background colours. Settings are remembered in the browser.

## Saving: the Changes list
Nothing is written while you edit. Every change (hull file, variant, ship stats, weapon row, .wpn,
description, projectile, wing, fighter stats) shows up automatically in **Changes** (top right; the count
shows how many files will be written). Open it with the button or **Ctrl+S** to see:
* which file each change writes, in which mod, and whether it is a new file, an overwrite, a replaced CSV
  row or an added row (and "+ backup" when the current file will be backed up);
* a line-by-line diff against the file on disk, and for CSV rows a column summary (`range: 420 → 480`);
* **Discard** on any entry (undoes that change in the editor), **Discard all**, and **Save all**.

Undoing an edit back to the original removes its entry. Switching to another weapon or wing, or closing a
ship tab, keeps its changes in the list; reopening it brings the edits back. Entries are marked "blocked"
until you pick a **Save to mod**.

Files that already live in a mod are updated in place (backed up first, see Backups). Vanilla files are
never touched: their edited copies go into your Save-to mod. CSV saves replace or append only the edited row
and leave every other line untouched.

## Hullmod description numbers
The `%s` values in hullmod descriptions come from the game's scripts. The optional mod
**Starforge Data Export** writes them to `saves/common/forge_bridge/hullmods.json.data` when the
game starts. Enable it and launch the game once whenever you add mods. It adds nothing in-game.

## Opening files
**📂 Files** in the header of a ship, weapon, strike craft, hullmod or ship system lists the files behind it:
ships show the .ship/.skin (and base hull for skins), the ship_data.csv, the open variant, the descriptions.csv
and the sprite. Weapons show the .wpn, weapon_data.csv, .proj, description and every sprite. Wings show the
wing_data.csv, fighter variant, fighter hull, its stats and sprite. Each has **Open** and **Show in folder**
(selected in Explorer).
* Open uses the text editor you set at the bottom of that menu (e.g. Notepad++ or VS Code; it applies to .ship,
  .wpn, .proj, .variant, .csv, .json and similar). Left blank, files open in their default app, or Notepad when
  nothing is associated.
* CSV files may open in Excel, which locks them: close it before saving from the editor.
* Files you just created only appear after Save all.

## Choosing which mods to load
**☰ Mods** (top right, also on the Sources tab) picks what the editor loads, then reloads:
* **Mods enabled in the game launcher**: the same mods the game uses (`mods/enabled_mods.json`).
* **All installed mods**: every mod folder, enabled or not.
* **Only the mods I choose**: tick individual mod folders. Shortcuts: Game's selection, All, None,
  Newest versions only, Add dependencies (ticks the mods your ticked mods need).
The list shows each mod's version, folder and game version, whether it's enabled in the game, whether it's loaded
in the editor right now, utility/total-conversion flags, missing dependencies, and which copy is newest when a mod
is installed more than once. Vanilla is always loaded. Your choice is remembered (in `starforge-settings.json`); the
game launcher's own selection is never changed. Reloading discards pending changes (you're asked first).

## Duplicate mod folders
If the mods folder holds several versions of the same mod (same id), the editor uses the newest version and lists
the others under Sources → warnings. The game itself expects only one, so it's worth moving old copies out.

## Multi-part ships (station modules)
* On a ship with modules, each module is drawn on its slot with its own fitted weapons and engine flames.
* Open a module hull and the ship it's mounted on (plus that ship's other modules) is drawn around it, positioned
  through the slot and the module anchor. If the module is used on several ships, a dropdown picks which one.
* **Attached** in the toolbar: **Visible**, **Transparent** or **Hidden** (remembered). Double-click to fit now
  fits the whole assembly.
* In View or Variant mode, hover an attached part to see what it is and **click it to open it** (with that exact
  variant). From a module, clicking the parent ship goes back to it.
* If the module or parent is open in another tab, its unsaved edits are shown.
* Picking modules: Variant mode → Station modules (or click a module slot twice). Module anchors: Centers mode.

## Backups
Before **Save all** changes any file, a copy goes to `Starforge/backups/<date_time>/` (one folder per save,
mirroring the file's path, plus a `manifest.json` listing every file and which ones were new). The newest 100
saves are kept. **Backups…** (in the Changes window and on the Sources tab) lists them: expand one to see its
files, **Folder** opens it, **Restore** puts every file from that save back as it was before (optionally removing
files that save created). Your current versions are backed up first, so a restore can itself be undone.
Nothing is written into mod folders (no more `.bak` files; old ones can be deleted).

## Tabs
Middle-click or ✕ closes a tab; right-click a tab for Close, Close others, Close tabs to the right and
Close all. Unsaved edits stay in the Changes list; reopen the hull to
continue.

## Where to put the editor
Anywhere. On start it looks for Starsector in this order:
1. `starsector-path.txt` next to the editor (written automatically once a folder has been chosen);
2. the folder around the editor (e.g. `Starsector\Starforge`);
3. the usual install places: the Windows installer's registry entry, `Program Files (x86)\Fractal Softworks\Starsector`,
   `<drive>:\Starsector`, `<drive>:\Games\Starsector`, any top-level folder with "starsector" in its name,
   `/Applications/Starsector.app` (macOS), `~/starsector` and `/opt/starsector` (Linux).
If none is found, the browser shows **Where is Starsector?** with the installs it did find and a folder browser
(Starsector folders are marked; picking a folder inside the game, such as `starsector-core`, also works).
The choice is saved to `starsector-path.txt`. To switch installs later: Sources tab → **Change…**.
The start scripts also use that file to find the Java that ships with the game.

## Other setups (sharing the editor)
* **Vanilla only**: works without any mods folder; **New mod…** creates `mods/` and `enabled_mods.json` as needed.
* **Java**: needs Java 11 or newer. Starsector 0.98 ships Java 17 in its `jre` folder, which the launcher uses
  (a `jdk-*` folder from a Java upgrade mod is preferred if present). Otherwise the system `java` is used.
* **Linux / macOS**: run `sh start-starforge.sh`. Supported layouts: Windows (`starsector-core/`),
  Linux (`data/` in the game folder) and macOS (`Starsector.app/Contents/Resources/Java/`, mods in
  `Starsector.app/mods`). On macOS put the Starforge folder next to Starsector.app.
* **Broken or unusual mods** (invalid JSON, empty files, odd CSVs, missing references, unusual characters in
  folder names) are skipped or reported under Sources → Warnings instead of stopping the editor.

## Safety
The editor runs entirely on your own computer. Nothing goes to the internet, and it only listens on 127.0.0.1,
so other devices on your network can't reach it.

- **Session key.** Each time it starts, the editor makes a random key and opens your browser with it
  (`http://127.0.0.1:8765/?t=…`). The browser swaps it for a private cookie and the key disappears from the address
  bar. Anything without that cookie is refused: other websites, other programs on your PC, and other Windows
  user accounts all get a "This editor window isn't unlocked" page. Running the start script again while the editor
  is open just reopens it. The link is also printed in the console window and kept in your user folder
  (`.forge-editor\session-<port>.txt`), readable only by you. Bookmarking `http://127.0.0.1:8765/` won't work
  after a restart; use the start script instead.
- **No scripts from mods.** Mod files are only ever shown as text. The page also tells the browser to run only the
  editor's own script files, so a mod's names or descriptions can never execute as code.
- **Files.** It reads only inside your Starsector folder, and it writes only inside `mods\`. Every save is backed up
  first (see Backups).
- **Browser version.** There's no server or open port at all. The page runs from files on your disk, and the browser
  only lets it touch the one folder you picked, after you allow it. It can't reach the internet: the page itself
  forbids any outside connections, and it uses only the editor's own script files.

The editor's Java/JS source is in `source/`.

## Licence and source
Starforge is **free software** under the **GNU General Public License v3.0 or later** (`LICENSE`).
You may use, share and change it, and pass on changed versions, as long as they stay under the GPL with their source
available. There is no warranty. The same notice is under **? Guide → About & licence**.

The complete source is on GitHub, in the Starforge repository the downloads come from (it's also in the
`source` folder if your copy has one). The repository's README explains how to build each part.

**Credits:** the engine flame textures come from Ontheheavens' Ship-Editor (public domain), which also inspired the
engine and slot editing. Inspired by Daedalus Forge. Starsector is © Fractal Softworks; the editor contains no game
files and reads them from your own install.
