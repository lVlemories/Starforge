// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Browser version: hooks the shared editor UI up to FORGE_LOCAL instead of the Java server. Loaded after all editor scripts.
(() => {
  const L = window.FORGE_LOCAL;


  // ---------------------------------------------------------------- remembered folder (IndexedDB keeps the folder handle)
  const IDB = {
    open() { return new Promise((ok, bad) => { const q = indexedDB.open("forge-editor", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error); }); },
    async get(k) { const db = await IDB.open(); return new Promise((ok, bad) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error); }); },
    async set(k, v) { const db = await IDB.open(); return new Promise((ok, bad) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => ok(); t.onerror = () => bad(t.error); }); },
  };

  // progress while loading (big mod lists take a while)
  const _boot = boot;
  boot = async function () {
    const t = setInterval(() => { const d = L.loadingData; if (d && !L.data) $("#loading").textContent = `Loading game data… ${d.progress.toLocaleString()} files read`; }, 250);
    try { return await _boot(); } finally { clearInterval(t); }
  };

  const supported = typeof window.showDirectoryPicker === "function";

  startup = async function () {
    if (window.FORGE_TEST_ROOT) { await L.useRoot(await window.FORGE_TEST_ROOT); return boot(); }
    $("#loading").classList.add("hidden");
    if (!supported) { unsupported(); return; }
    let h = null;
    try { h = await IDB.get("gameDir"); } catch (e) {}
    if (h) {
      let perm = "prompt";
      try { perm = await h.queryPermission({ mode: "readwrite" }); } catch (e) {}
      if (perm === "granted") {
        try { await L.useRoot(h); $("#loading").classList.remove("hidden"); return boot(); }
        catch (e) { return openGamePicker({ remembered: h, error: e.message }, true); }
      }
    }
    openGamePicker({ remembered: h }, true);
  };

  function unsupported() {
    openDialog("This browser can't open folders", "OK", `
      <p style="margin-top:0">The browser version of Starforge needs a browser that lets a page work with a folder on your computer:
        <b>Chrome</b>, <b>Edge</b>, <b>Opera</b>, <b>Vivaldi</b> or another Chromium-based browser (Brave only with its file-system setting on).</p>
      <p>Firefox and Safari can't do this. Use the Java version instead (<code>Start Starforge.bat</code>), which works in any browser.</p>`, () => false);
    $("#dlg-cancel").style.display = "none";
  }

  /** Asks for the Starsector folder. st: {remembered: handle, error}. first = nothing loaded yet (can't cancel). */
  openGamePicker = async function (st, first) {
    st = st || {};
    if (!supported && !window.FORGE_TEST_ROOT) { unsupported(); return; }
    let remembered = st.remembered;
    if (!remembered) { try { remembered = await IDB.get("gameDir"); } catch (e) {} }
    openDialog(first ? "Where is Starsector?" : "Choose a Starsector folder", "Choose folder…", `
      <p style="margin-top:0">Pick the folder that contains <code>starsector-core</code> and <code>mods</code> (Windows), <code>Starsector.app</code> (macOS)
        or <code>starsector.sh</code> (Linux). The browser will ask you to let this page view and edit files in it: the editor reads the game and your mods,
        and only ever writes inside <code>mods</code>.</p>
      ${remembered ? `<div class="gp-row"><code>${esc(remembered.name)}</code><button id="gp-again" class="primary">${first ? "Continue with this folder" : "Use again"}</button></div>
        <p class="muted" style="font-size:12px">The folder you used last time. The browser may ask again for permission each time you open the editor.</p>` : ""}
      <p class="muted" style="font-size:12px">Chrome doesn't allow folders inside <code>Program Files</code>. If Starsector is installed there (the default on Windows),
        use the Java version, or copy or move the Starsector folder somewhere else, such as <code>C:\\Games\\Starsector</code>.</p>
      <div id="gp-state" style="font-size:12px;margin-top:6px">${st.error ? `<span class="mm-warn">${esc(st.error)}</span>` : ""}</div>`,
      async () => { await pick(first); return false; });
    if (first) $("#dlg-cancel").style.display = "none";
    const again = $("#gp-again");
    if (again) again.onclick = async () => {
      try {
        if ((await remembered.requestPermission({ mode: "readwrite" })) !== "granted") { state("Permission wasn't given. Choose the folder again, or allow access when the browser asks."); return; }
        await use(remembered, first);
      } catch (e) { state(e.message); }
    };
  };
  const state = (msg) => { const el = $("#gp-state"); if (el) el.innerHTML = `<span class="mm-warn">${esc(msg)}</span>`; };

  async function pick(first) {
    let h;
    try { h = await window.showDirectoryPicker({ id: "forge-starsector", mode: "readwrite" }); }
    catch (e) {
      if (e.name === "AbortError") return;
      state(e.name === "SecurityError" || /system|blocked|not allowed/i.test(e.message)
        ? "The browser won't open that folder (it protects system folders such as Program Files). Use the Java version, or move Starsector somewhere else."
        : "Couldn't open the folder: " + e.message);
      return;
    }
    try { await use(h, first); } catch (e) { state(e.message); }
  }

  async function use(h, first) {
    if (!first && CH.entries.size && !confirm(`Switching discards ${CH.entries.size} pending change(s) and closes all tabs. Continue?`)) return;
    await L.useRoot(h, { load: first }); // when switching, reloadAll() below does the loading
    try { await IDB.set("gameDir", h); } catch (e) {}
    closeDialog();
    toast("Using " + h.name);
    if (first) { $("#loading").classList.remove("hidden"); await boot(); }
    else { CH.entries.clear(); await reloadAll(); }
  }

  // ---------------------------------------------------------------- things only the Java version can do
  const _ofm = openFilesMenu;
  openFilesMenu = function (anchor, items) {
    _ofm(anchor, items);
    const m = $("#files-menu"); if (!m) return;
    m.querySelectorAll('[data-a="reveal"]').forEach((b) => b.remove());
    m.querySelectorAll('[data-a="open"]').forEach((b) => { b.title = "Show the file read-only in a new browser tab"; b.textContent = "View"; });
    const head = m.querySelector(".fm-head"); if (head) head.innerHTML = 'Files <span class="muted">(paths inside your Starsector folder)</span>';
    const foot = m.querySelector(".fm-foot");
    if (foot) foot.innerHTML = `<span class="muted" style="font-size:12px">The browser version can only show files. To edit one by hand, open it in your own text editor from the path above.</span>`;
  };

  const _ob = openBackups;
  async function backupsLocal() {
    await _ob();
    const f = $("#bk-folder");
    if (f) f.replaceWith(Object.assign(document.createElement("span"), { className: "muted", style: "font-size:12px", textContent: "They're kept in mods/starforge-backups (the game ignores that folder)." }));
    document.querySelectorAll("#dlg-body [data-show]").forEach((b) => b.remove());
  }
  openBackups = backupsLocal;
  $("#changes-backups").onclick = backupsLocal;
  $("#open-backups").onclick = backupsLocal;

  const cb = $("#changes-backups"); if (cb) cb.title = "Every file is copied to mods/starforge-backups before Save all changes it. Restore puts a save back.";
  document.title = "Starforge (browser)";
})();
