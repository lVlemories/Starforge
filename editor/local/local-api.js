// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Browser version: the /api routes (port of Server.java), backups (Backups.java), zip export, and asset URLs.
(() => {
  const L = window.FORGE_LOCAL, FS = L.FS, Json = L.Json, Csv = L.Csv, abs = L.abs, toRel = L.toRel, jn = L.jn;
  const str = (o) => (o == null ? null : String(o));

  // ---------------------------------------------------------------- state
  L.data = null; L.loading = null; L.lay = null;
  const SETTINGS_KEY = "forge.local.settings";
  function settings() {
    let m = null;
    try { m = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) {}
    if (!m || typeof m !== "object") m = { modMode: "all" };
    if (m.modMode == null) m.modMode = m.allMods === false ? "enabled" : "all";
    return m;
  }
  function saveSettings(m) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(m)); } catch (e) {} }
  L.settings = settings;

  /** Starts (re)loading the game data. */
  L.reload = () => {
    const st = settings();
    const d = new L.GameData(L.lay, st.modMode, Json.arr(st.selectedFolders) || []);
    L.data = null;
    L.loadingData = d;
    FS.reset(); ASSETS.clear(); ASSET_DONE.clear();
    const t = performance.now();
    L.loading = d.load().then(() => {
      L.data = d;
      console.log(`Loaded ${d.sources.length} sources, ${d.hullFiles.size} hulls, ${d.weapons.size} weapons, ${d.hullmods.size} hullmods, ${d.wings.size} wings in ${Math.round(performance.now() - t)} ms`);
      return d;
    });
    return L.loading;
  };

  /** Uses a picked folder (or one of its parents' layouts). Throws a friendly message if it isn't a Starsector folder. */
  L.useRoot = async (handle, opts = {}) => {
    FS.root = handle; FS.name = handle.name; FS.reset();
    const lay = await L.layout();
    if (lay.core == null) {
      FS.root = null;
      throw new Error("That isn't a Starsector folder. Choose the folder that contains starsector-core (Windows), Starsector.app (macOS) or data and starsector.sh (Linux).");
    }
    if (lay.core === "" && /^starsector-core$/i.test(handle.name)) {
      FS.root = null;
      throw new Error("That's the starsector-core folder. Choose the folder one level up (the one that also contains mods), so your mods can be loaded and saved.");
    }
    L.lay = lay;
    if (opts.load !== false) L.reload();
    rootedOk();
    return lay;
  };

  // one write at a time (saves, backups and restores never interleave)
  let chain = Promise.resolve();
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

  // ---------------------------------------------------------------- backups (inside mods/, which the game ignores without a mod_info.json)
  const KEEP = 100;
  const bkRoot = () => jn(L.data.modsRel, "starforge-backups");
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d = new Date(), sep = "_", tsep = "-") => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${sep}${pad(d.getHours())}${tsep}${pad(d.getMinutes())}${tsep}${pad(d.getSeconds())}`;
  const clean = (b) => { const x = String(b == null ? "" : b).replace(/[^0-9A-Za-z_.-]/g, ""); return x || stamp(); };

  /** Call before writing rel. Keeps only the first copy per batch, so it's the state before this Save all. */
  async function backupBefore(rel, batch, what) {
    try {
      rel = await FS.real(rel);
      const dir = jn(bkRoot(), clean(batch)), mf = jn(dir, "manifest.json");
      let man = (await FS.isFile(mf)) ? await L.readJson(mf) : null;
      if (!man) man = { time: stamp(new Date(), " ", ":"), files: [] };
      const files = Json.arr(man.files) || (man.files = []);
      if (files.some((o) => Json.obj(o) && o.path === abs(rel))) return;
      const exists = await FS.isFile(rel);
      const e = { path: abs(rel), existed: exists };
      if (what != null) e.what = what;
      if (exists) {
        const copy = jn("files", rel);
        await FS.write(jn(dir, copy), await FS.bytes(rel));
        e.copy = copy;
      }
      files.push(e);
      await FS.write(mf, Json.pretty(man));
      await prune();
    } catch (ex) { console.error("Backup of " + rel + " failed: " + ex.message); }
  }
  async function batches() {
    const out = [];
    for (const e of await FS.list(bkRoot())) if (e.kind === "directory" && await FS.isFile(jn(bkRoot(), e.name, "manifest.json"))) out.push(e.name);
    return out.sort().reverse();
  }
  async function prune() { const all = await batches(); for (let i = KEEP; i < all.length; i++) await FS.remove(jn(bkRoot(), all[i]), true); }
  async function listBackups() {
    const out = [];
    for (const id of await batches()) {
      try { const man = await L.readJson(jn(bkRoot(), id, "manifest.json")); out.push({ id, time: man.time, files: man.files, restoredFrom: man.restoredFrom == null ? null : man.restoredFrom }); } catch (e) {}
    }
    return out;
  }
  async function restore(id, removeCreated) {
    const d = L.data, dir = jn(bkRoot(), clean(id));
    const man = await L.readJson(jn(dir, "manifest.json"));
    const undo = stamp() + "_before-restore";
    let restored = 0, removed = 0;
    const problems = [];
    for (const o of Json.arr(man.files) || []) {
      const e = Json.obj(o); if (!e) continue;
      let rel;
      try { rel = toRel(e.path); } catch (x) { problems.push(e.path + ": not in this Starsector folder, skipped"); continue; }
      if (!d.isWritable(rel)) { problems.push(e.path + ": outside the mods folder, skipped"); continue; }
      await backupBefore(rel, undo, "before restoring " + id);
      if (e.existed === true && e.copy != null) { await FS.write(rel, await FS.bytes(jn(dir, String(e.copy)))); restored++; }
      else if (removeCreated && await FS.isFile(rel)) { await FS.remove(rel); removed++; }
    }
    const um = jn(bkRoot(), undo, "manifest.json");
    if (await FS.isFile(um)) { const m = await L.readJson(um); m.restoredFrom = id; await FS.write(um, Json.pretty(m)); }
    return { restored, removed, problems, undo };
  }

  // ---------------------------------------------------------------- CSV row saves
  async function computeCsvRow(rel, body) {
    const row = Json.obj(body.row) || {};
    const keys = (Json.arr(body.keys) || ["id"]).map(String);
    const r = {};
    let nl = "\r\n", text, oldText = "";
    if (await FS.isFile(rel)) {
      text = await FS.text(rel); oldText = text;
      if (text.includes("\r\n")) nl = "\r\n"; else if (text.includes("\n")) nl = "\n";
    } else {
      const cols = Json.arr(body.columns);
      const header = cols ? cols.map(String) : Object.keys(row).filter((k) => !k.startsWith("_"));
      text = Csv.line(header, Object.fromEntries(header.map((h) => [h, h]))) + nl;
      r.created = true;
    }
    const recs = Csv.spans(text);
    const header = recs[0].cells.map((h) => h.trim());
    const missing = Object.keys(row).filter((k) => !k.startsWith("_") && !header.includes(k) && row[k] != null && String(row[k]) !== "");
    let match = null;
    for (let i = 1; i < recs.length; i++) {
      const rec = recs[i];
      let ok = true;
      for (const k of keys) {
        const c = header.indexOf(k);
        const v = c >= 0 && c < rec.cells.length ? rec.cells[c].trim() : "";
        if (v !== (row[k] == null ? "null" : String(row[k])).trim()) { ok = false; break; }
      }
      if (ok) match = rec;
    }
    const line = Csv.line([...header, ...missing], row);
    let out = text;
    if (match) {
      const hadNl = match.end > match.start && (text[match.end - 1] === "\n" || text[match.end - 1] === "\r");
      out = text.slice(0, match.start) + line + (hadNl ? nl : "") + text.slice(match.end);
      r.action = "replaced";
    } else {
      if (out.length && out[out.length - 1] !== "\n") out += nl;
      out += line + nl;
      r.action = "appended";
    }
    if (missing.length) {
      const h = recs[0];
      const hl = text.slice(h.start, h.end).replace(/[\r\n]+$/, "");
      out = out.slice(0, h.start) + hl + missing.map((m) => "," + Csv.quote(m)).join("") + out.slice(h.start + hl.length);
    }
    r.oldText = oldText; r.newText = out; r.path = abs(rel);
    return r;
  }

  async function createMod(d, b) {
    const id = String(b.id).trim(), name = String(b.name).trim();
    if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("Mod id may only use letters, digits, _ - and .");
    if (d.sources.some((s) => s.id === id)) throw new Error("A mod with id '" + id + "' is already loaded.");
    let folder = name.replace(/[\\/:*?"<>|]/g, "").trim();
    if (!folder) folder = id;
    const root = jn(d.modsRel, folder);
    if ((await FS.isDir(root)) || (await FS.isFile(root))) throw new Error("Folder mods/" + folder + " already exists.");
    const version = String(b.version != null ? b.version : "1.0.0");
    const info = { id, name, author: String(b.author != null ? b.author : ""), utility: "false", version,
      description: String(b.description != null ? b.description : ""), gameVersion: String(b.gameVersion != null ? b.gameVersion : "0.98.5a") };
    await FS.mkdir(jn(root, "data/hulls"));
    await FS.write(jn(root, "mod_info.json"), Json.pretty(info));
    const created = [abs(jn(root, "mod_info.json"))];
    if (b.versionChecker === true) {
      const v = (version + ".0.0").split(".");
      const vf = { masterVersionFile: String(b.masterVersionFile != null ? b.masterVersionFile : ""), modName: name, modThreadId: "", modVersion: { major: v[0], minor: v[1], patch: v[2] } };
      await FS.write(jn(root, id + ".version"), Json.pretty(vf));
      await FS.write(jn(root, "data/config/version/version_files.csv"), "version file\r\n" + id + ".version\r\n");
      created.push(abs(jn(root, id + ".version")), abs(jn(root, "data/config/version/version_files.csv")));
    }
    let enabled = false;
    if (b.enable === true) {
      const em = jn(d.modsRel, "enabled_mods.json");
      let m = (await FS.isFile(em)) ? await L.readJson(em) : {};
      if (!m) m = {};
      let list = Json.arr(m.enabledMods);
      if (!list) { list = []; m.enabledMods = list; }
      if (!list.includes(id)) list.push(id);
      await backupBefore(em, null, "enabling " + id);
      await FS.write(em, Json.pretty(m));
      enabled = true;
    }
    const src = { id, name, version, rel: await FS.real(root), core: false, enabled };
    d.sources.push(src);
    return { source: d.srcJson(src), created };
  }

  // ---------------------------------------------------------------- zip export (deflate via the browser's CompressionStream)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function deflate(b) {
    if (typeof CompressionStream === "undefined") return null;
    return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  }
  async function zipMod(rootRel) {
    const top = rootRel.split("/").pop();
    const files = [];
    await FS.walk(rootRel, null, (r, e) => files.push(r));
    files.sort();
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    const dirs = new Set();
    const entries = [];
    for (const f of files) {
      const rel = f.slice(rootRel.length + 1), low = rel.toLowerCase();
      if (low.endsWith(".bak") || low.startsWith(".git") || low.includes("/.git") || low.endsWith("thumbs.db") || low.endsWith(".ds_store") || low.endsWith(".crswap")) continue;
      const segs = rel.split("/");
      for (let i = 1; i < segs.length; i++) { const dp = segs.slice(0, i).join("/") + "/"; if (!dirs.has(dp)) { dirs.add(dp); entries.push({ name: dp }); } }
      entries.push({ name: rel, rel: f });
    }
    for (const e of entries) {
      const name = enc.encode(top + "/" + e.name);
      let data = new Uint8Array(0), comp = data, method = 0, crc = 0, mod = new Date();
      if (e.rel) {
        const file = await FS.file(e.rel);
        mod = new Date(file.lastModified);
        data = new Uint8Array(await file.arrayBuffer());
        crc = crc32(data);
        const z = data.length > 64 ? await deflate(data) : null;
        if (z && z.length < data.length) { comp = z; method = 8; } else comp = data;
      }
      const dt = ((Math.max(1980, mod.getFullYear()) - 1980) << 9) | ((mod.getMonth() + 1) << 5) | mod.getDate();
      const tm = (mod.getHours() << 11) | (mod.getMinutes() << 5) | (mod.getSeconds() >> 1);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, name, comp);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(38, e.rel ? 0 : 0x10, true); c.setUint32(42, off, true);
      central.push(c.buffer, name);
      off += 30 + name.length + comp.length;
    }
    let csize = 0; for (const p of central) csize += p.byteLength;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return { name: top.replace(/[^A-Za-z0-9 ._()-]/g, "_") + ".zip", blob: new Blob([...parts, ...central, end.buffer], { type: "application/zip" }) };
  }
  L.exportMod = async (id) => {
    const d = await L.loading;
    const src = d.sources.find((s) => !s.core && s.id === id);
    if (!src) throw new Error("No such mod");
    const z = await zipMod(src.rel);
    const a = document.createElement("a"); a.href = URL.createObjectURL(z.blob); a.download = z.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return z;
  };
  L.zipMod = zipMod;

  // ---------------------------------------------------------------- assets (game-relative paths -> blob: URLs)
  const ASSETS = new Map(), ASSET_DONE = new Map();
  /** Promise of a blob: URL for a game-relative path, or null if no source has it. */
  L.assetUrl = (rel) => {
    rel = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
    const key = rel.toLowerCase();
    let p = ASSETS.get(key);
    if (!p) {
      p = (async () => {
        const d = L.data || (L.loading && await L.loading);
        if (!d) return null;
        const real = await d.resolveAsset(rel);
        if (!real) return null;
        return URL.createObjectURL(await FS.file(real));
      })().catch(() => null);
      ASSETS.set(key, p);
      p.then((u) => ASSET_DONE.set(key, u));
    }
    return p;
  };
  /** The URL if it's already known (undefined if not looked up yet). */
  L.assetKnown = (rel) => ASSET_DONE.get(String(rel).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase());
  const forgetAssets = () => { ASSETS.clear(); ASSET_DONE.clear(); };

  const TEXT_EXT = new Set(["ship", "skin", "variant", "wpn", "proj", "system", "faction", "json", "csv", "txt", "md", "java", "version"]);
  async function openInTab(rel) {
    const file = await FS.file(rel);
    const ext = rel.split(".").pop().toLowerCase();
    const type = TEXT_EXT.has(ext) ? "text/plain;charset=utf-8" : file.type || "application/octet-stream";
    const url = URL.createObjectURL(new Blob([file], { type }));
    const w = window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    if (!w) throw new Error("the browser blocked the new tab. Allow pop-ups for this page and try again.");
    return { how: "a new browser tab (read-only view)" };
  }

  // ---------------------------------------------------------------- routes
  const bad = (msg) => { throw new Error(msg); };
  async function hull(d, id) {
    const file = d.hullFiles.get(id);
    if (!file) return null;
    const out = { file };
    const j = await L.readJson(toRel(file.path));
    if (file.kind === "skin") {
      const base = String(j.baseHullId), bf = d.hullFiles.get(base);
      if (bf) { out.baseFile = bf; out.baseShip = Json.parse(await FS.text(toRel(bf.path))); out.csv = d.ships.get(base) || null; }
      out.skin = j;
    } else { out.ship = j; out.csv = d.ships.get(id) || null; }
    return out;
  }
  function targetOf(body) {
    return body.rel != null ? jn(toRel(body.root), String(body.rel)) : toRel(body.path);
  }

  let rootedOk; const rooted = new Promise((ok) => (rootedOk = ok));
  /** What the editor's api() calls (a JSON round trip keeps the UI from sharing objects with the data). */
  L.api = async (path, body) => { const r = await L.route(path, body); return r === undefined ? null : JSON.parse(JSON.stringify(r)); };

  L.route = async (url, body) => {
    const u = new URL(url, "http://forge.local/");
    const path = u.pathname, q = Object.fromEntries(u.searchParams.entries());
    const post = body !== undefined;
    if (path === "/api/whoami") return "forge-editor";
    if (path === "/api/setup") return { gameDir: FS.root ? FS.name : null, found: [], pathFile: "" };
    if (!L.loading) await rooted; // like the Java server's "still loading": wait until a folder is chosen
    const d = await L.loading;
    switch (path) {
      case "/api/summary": {
        const counts = { hulls: d.hullFiles.size, variants: d.variants.size, weapons: d.weapons.size, hullmods: d.hullmods.size, wings: d.wings.size, systems: d.systems.size };
        return { gameDir: FS.name, sources: d.sources.map((s) => d.srcJson(s)), warnings: d.warnings, counts };
      }
      case "/api/hulls":
        return [...d.hullFiles.values()].map((h) => {
          const e = Object.assign({}, h), row = d.ships.get(String(h.hullId));
          if (row) { e.designation = row.designation; e.hints = row.hints; }
          if (e.hullSize == null && h.baseHullId != null) { const base = d.hullFiles.get(String(h.baseHullId)); if (base) e.hullSize = base.hullSize; }
          return e;
        });
      case "/api/hull": return hull(d, q.id);
      case "/api/variants": return [...d.variants.values()].filter((v) => q.hull == null || v.hullId === q.hull);
      case "/api/file": return Json.parse(await FS.text(toRel(q.path)));
      case "/api/hullmods": return [...d.hullmods.values()];
      case "/api/weapons": return [...d.weapons.values()];
      case "/api/wings":
        return [...d.wings.values()].map((w) => {
          const r = Object.assign({}, w), v = d.variants.get(String(w.variant)), h = v ? d.hullFiles.get(String(v.hullId)) : null;
          let sprite = h ? h.spriteName : null;
          if ((!sprite || sprite === "null") && h && h.baseHullId != null) { const b2 = d.hullFiles.get(String(h.baseHullId)); if (b2) sprite = b2.spriteName; }
          if (sprite != null && sprite !== "null") r._sprite = sprite;
          if (h) r._hullName = h.hullName;
          return r;
        });
      case "/api/systems": return [...d.systems.values()];
      case "/api/styles": return { engine: d.engineStyles, hull: d.hullStyles };
      case "/api/settings": {
        const st = settings();
        if (post) { Object.assign(st, body || {}); saveSettings(st); }
        return st;
      }
      case "/api/modlist": {
        const list = await L.scanMods(d.modsRel);
        for (const m of list) m.loaded = d.sources.some((s) => !s.core && s.rel.split("/").pop() === m.folder);
        return list;
      }
      case "/api/description": { const x = d.descriptions.get(q.type + ":" + q.id); return x === undefined ? null : x; }
      case "/api/save": return serial(async () => {
        const rel = await FS.real(targetOf(body));
        if (!d.isWritable(rel)) bad("Only files inside the mods folder can be saved; the game install stays read-only.");
        await backupBefore(rel, body.batch == null ? null : String(body.batch), null);
        if (body.base64 != null) {
          const bin = atob(String(body.base64)), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          await FS.write(rel, bytes); d.imageIndex = null; forgetAssets();
        } else await FS.write(rel, String(body.content));
        await d.reindex(rel);
        return { path: abs(rel) };
      });
      case "/api/csvrow": return serial(async () => {
        const rel = await FS.real(targetOf(body));
        if (!d.isWritable(rel)) bad("Only files inside the mods folder can be saved; the game install stays read-only.");
        const c = await computeCsvRow(rel, body);
        await backupBefore(rel, body.batch == null ? null : String(body.batch), null);
        await FS.write(rel, c.newText);
        d.updateRow(String(body.kind), Json.obj(body.row) || {}, rel);
        return { action: c.action, path: abs(rel) };
      });
      case "/api/preview": {
        const rel = await FS.real(targetOf(body));
        const exists = await FS.isFile(rel);
        let r;
        if (body.type === "csv") r = await computeCsvRow(rel, body);
        else if (body.base64 != null) r = { binary: true, bytes: atob(String(body.base64)).length, oldBytes: exists ? (await FS.file(rel)).size : 0, oldText: "", newText: "", path: abs(rel), action: exists ? "overwrite" : "create" };
        else r = { oldText: exists ? await FS.text(rel) : "", newText: String(body.content), path: abs(rel), action: exists ? "overwrite" : "create" };
        r.exists = exists; r.writable = d.isWritable(rel); r.backup = exists;
        return r;
      }
      case "/api/newmod": return serial(() => createMod(d, body || {}));
      case "/api/proj": {
        const e = d.projFiles.get(q.id); if (!e) return null;
        return Object.assign({}, e, { json: Json.parse(await FS.text(toRel(e.path))) });
      }
      case "/api/csvheader": { const rows = Csv.rows(await FS.text(toRel(q.path))); return rows.length ? rows[0] : []; }
      case "/api/factions": return d.factionsSummary();
      case "/api/roles": return Object.fromEntries(d.roles);
      case "/api/moduleparents": return d.moduleParents(q.hull);
      case "/api/usage": return d.usage(q.kind, q.id);
      case "/api/sound": { const x = d.sounds.get(q.id); return x === undefined ? null : x; }
      case "/api/systemfile": {
        const e = d.systemFiles.get(q.id); if (!e) return null;
        return Object.assign({}, e, { json: Json.parse(await FS.text(toRel(e.path))) });
      }
      case "/api/images": return d.images();
      case "/api/openfile": {
        const rel = body.rel != null ? await d.resolveAsset(String(body.rel)) : toRel(body.path);
        if (!rel || !(await FS.isFile(rel))) bad("File not found (not saved yet?)");
        if (body.reveal) bad("the browser version can't open folders. The file is at " + abs(rel));
        return openInTab(rel);
      }
      case "/api/backups": return { folder: abs(bkRoot()), keep: KEEP, batches: await listBackups() };
      case "/api/backups/open": bad("the browser version can't open folders. Backups are in " + abs(bkRoot())); break;
      case "/api/backups/restore": {
        const r = await serial(() => restore(String(body.id), body.removeCreated === true));
        L.reload();
        return r;
      }
      case "/api/reload": L.reload(); return true;
      case "/api/exportmod": return L.exportMod(q.id).then((z) => ({ name: z.name, bytes: z.blob.size }));
    }
    bad("Not found: " + path);
  };
  L.computeCsvRow = computeCsvRow;
})();
