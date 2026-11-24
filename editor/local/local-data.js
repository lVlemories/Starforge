// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Browser version: game data loading (port of GameData.java), backups (Backups.java) and the /api routes (Server.java).
(() => {
  const L = window.FORGE_LOCAL, FS = L.FS, Json = L.Json, Csv = L.Csv, abs = L.abs, toRel = L.toRel;
  const str = (o) => (o == null ? null : String(o));
  const lc = (s) => String(s).toLowerCase();
  const jn = (...xs) => xs.filter((x) => x != null && x !== "").join("/");

  async function readJson(rel) { return Json.obj(Json.parse(await FS.text(rel))); }

  // ================================================================ install layout
  /** {core, mods, common} relative paths (core null if this isn't a Starsector folder). Same rules as GameData.layout. */
  async function layout() {
    let core = null, root = "";
    for (const c of ["starsector-core", "", "Contents/Resources/Java", "Starsector.app/Contents/Resources/Java"]) {
      if (await FS.isDir(jn(c, "data/hulls")) && await FS.isDir(jn(c, "graphics"))
        && (await FS.isFile(jn(c, "starfarer.api.jar")) || await FS.isFile(jn(c, "starfarer_obf.jar")))) { core = c; break; }
    }
    if (core != null && core.endsWith("Contents/Resources/Java")) root = core.split("/").slice(0, -3).join("/");
    let mods = jn(root, "mods");
    if (!(await FS.isDir(mods)) && root !== "" && await FS.isDir("mods")) mods = "mods";
    return { core, mods, common: jn(root, "saves/common") };
  }
  L.layout = layout;

  // ================================================================ versions
  function compareVersions(a, b) {
    const x = String(a || "").split(/[^0-9A-Za-z]+/), y = String(b || "").split(/[^0-9A-Za-z]+/);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const p = i < x.length ? x[i] : "0", q = i < y.length ? y[i] : "0";
      const mp = /^(\d*)(.*)$/.exec(p), mq = /^(\d*)(.*)$/.exec(q);
      const np = mp[1] ? +mp[1].slice(0, 15) : 0, nq = mq[1] ? +mq[1].slice(0, 15) : 0;
      if (np !== nq) return np < nq ? -1 : 1;
      const c = mp[2].toLowerCase().localeCompare(mq[2].toLowerCase());
      if (c !== 0) return c;
    }
    return 0;
  }
  const fmtN = (o) => (o == null ? "0" : typeof o === "number" && Number.isInteger(o) ? String(o) : String(o));
  const versionOf = (v) => (Json.obj(v) ? fmtN(v.major) + "." + fmtN(v.minor) + "." + fmtN(v.patch) : v == null ? "" : String(v));
  const folderOf = (rel) => rel.split("/").pop();

  async function enabledIds(modsRel) {
    try {
      const em = await readJson(jn(modsRel, "enabled_mods.json"));
      const list = em && Json.arr(em.enabledMods);
      return list ? list.map(String) : [];
    } catch (e) { return null; }
  }

  /** Every mod folder with an active mod_info.json (cheap scan, for the mod picker). */
  async function scanMods(modsRel) {
    const enabled = (await enabledIds(modsRel)) || [];
    const out = [];
    const dirs = (await FS.list(modsRel)).filter((e) => e.kind === "directory");
    await Promise.all(dirs.map(async (d) => {
      const dir = jn(modsRel, d.name);
      if (!(await FS.isFile(jn(dir, "mod_info.json")))) return;
      const m = { folder: d.name };
      try {
        const mi = await readJson(jn(dir, "mod_info.json"));
        if (!mi || mi.id == null) return;
        const id = String(mi.id);
        m.id = id; m.name = String(mi.name != null ? mi.name : id); m.version = versionOf(mi.version);
        m.gameVersion = mi.gameVersion == null ? "" : String(mi.gameVersion);
        m.author = mi.author == null ? "" : String(mi.author);
        m.utility = lc(mi.utility) === "true"; m.totalConversion = lc(mi.totalConversion) === "true";
        m.dependencies = (Json.arr(mi.dependencies) || []).map((o) => Json.obj(o) && o.id != null ? String(o.id) : null).filter((x) => x != null);
        m.enabledInGame = enabled.includes(id);
        m.hasData = (await FS.isDir(jn(dir, "data"))) || (await FS.isDir(jn(dir, "graphics")));
      } catch (e) { m.error = "Unreadable mod_info.json: " + e.message; }
      out.push(m);
    }));
    out.sort((a, b) => a.folder.localeCompare(b.folder));
    return out;
  }

  // ================================================================ game data
  class GameData {
    constructor(lay, modMode, selected) {
      this.lay = lay;
      this.coreRel = lay.core; this.modsRel = lay.mods; this.commonRel = lay.common;
      this.modMode = modMode || "all";
      this.selected = new Set((selected || []).map(lc));
      this.sources = []; this.warnings = [];
      for (const k of ["ships", "hullmods", "weapons", "wings", "systems", "descriptions", "hullFiles", "projFiles", "variants", "variantRefs", "hullRefs",
        "factionParts", "roles", "sounds", "systemFiles"]) this[k] = new Map();
      this.engineStyles = {}; this.hullStyles = {};
      this.imageIndex = null;
      this.progress = 0;
    }
    srcJson(s) { return { id: s.id, name: s.name, version: s.version, root: abs(s.rel), core: s.core, enabled: s.enabled }; }

    async resolveSources() {
      this.sources.push({ id: "starsector-core", name: "Starsector", version: "", rel: this.coreRel, core: true, enabled: true });
      if (!(await FS.isDir(this.modsRel))) return;
      let enabled = [];
      if (await FS.isFile(jn(this.modsRel, "enabled_mods.json"))) {
        const e = await enabledIds(this.modsRel);
        if (e == null) this.warnings.push("Could not read mods/enabled_mods.json"); else enabled = e;
      }
      const byId = new Map();
      const dirs = (await FS.list(this.modsRel)).filter((e) => e.kind === "directory").sort((a, b) => a.name.localeCompare(b.name));
      const found = await Promise.all(dirs.map(async (d) => {
        const dir = jn(this.modsRel, d.name);
        if (!(await FS.isFile(jn(dir, "mod_info.json")))) return null;
        try {
          const mi = await readJson(jn(dir, "mod_info.json"));
          if (!mi || mi.id == null) return null;
          const id = String(mi.id);
          return { id, name: String(mi.name != null ? mi.name : id), version: versionOf(mi.version), rel: dir, core: false, enabled: true };
        } catch (e) { this.warnings.push("Unreadable mod_info.json in " + d.name + ": " + e.message); return null; }
      }));
      for (const s of found) if (s) { if (!byId.has(s.id)) byId.set(s.id, []); byId.get(s.id).push(s); }
      const wanted = [];
      if (this.modMode === "custom") {
        for (const [id, list] of byId) {
          const keep = list.filter((x) => this.selected.has(lc(folderOf(x.rel))));
          byId.set(id, keep);
          if (keep.length) wanted.push(id);
        }
        for (const f of this.selected) {
          let ok = false;
          for (const s of found) if (s && lc(folderOf(s.rel)) === f) ok = true;
          if (!ok) this.warnings.push("Selected mod folder '" + f + "' is no longer in the mods folder (or has no active mod_info.json).");
        }
      } else {
        wanted.push(...enabled);
        if (this.modMode === "all") for (const id of byId.keys()) if (!wanted.includes(id)) wanted.push(id);
      }
      const mods = [];
      for (const id of wanted) {
        const c = byId.get(id);
        if (!c || !c.length) { if (this.modMode !== "custom") this.warnings.push("Enabled mod '" + id + "' has no folder with an active mod_info.json."); continue; }
        if (mods.some((m) => m.id === id)) continue;
        if (c.length > 1) this.warnings.push("Mod '" + id + "' has " + c.length + " active folders (" + c.map((s) => folderOf(s.rel) + "; ").join("") + "). Using the newest version; move the others out of the mods folder.");
        let chosen = c[0];
        for (const x of c) {
          const cv = compareVersions(x.version, chosen.version);
          if (cv > 0 || (cv === 0 && lc(folderOf(x.rel)).localeCompare(lc(folderOf(chosen.rel))) > 0)) chosen = x;
        }
        chosen.enabled = enabled.includes(id);
        mods.push(chosen);
      }
      mods.sort((a, b) => lc(a.id).localeCompare(lc(b.id)));
      this.sources.push(...mods);
    }

    async load() {
      await this.resolveSources();
      const shards = await Promise.all(this.sources.map((s) => this.loadSource(s).catch((e) => { this.warnings.push("Loading failed for " + s.id + ": " + e.message); return null; })));
      for (const g of shards) {
        if (!g) continue;
        for (const k of ["ships", "hullmods", "weapons", "wings", "systems"]) absorb(g[k], this[k]);
        for (const k of ["descriptions", "hullFiles", "projFiles", "variants", "variantRefs", "hullRefs", "sounds", "systemFiles"]) for (const [a, b] of g[k]) this[k].set(a, b);
        Object.assign(this.engineStyles, g.engineStyles); Object.assign(this.hullStyles, g.hullStyles);
        for (const [k, v] of g.factionParts) { if (!this.factionParts.has(k)) this.factionParts.set(k, []); this.factionParts.get(k).push(...v); }
        for (const [k, v] of g.roles) { if (!this.roles.has(k)) this.roles.set(k, {}); Object.assign(this.roles.get(k), v); }
        this.warnings.push(...g.warnings);
      }
      for (const [k, r] of [...this.weapons]) if (r._wpnOnly) this.weapons.delete(k);
      await this.attachHullmodExport();
    }

    /** Everything one source contributes, parsed into its own shard (merged in load order afterwards). */
    async loadSource(src) {
      const g = new GameData(this.lay, this.modMode, []);
      g.sources = this.sources;
      const tick = () => { this.progress++; };
      // reads all matching files concurrently, then handles them in a fixed order
      const parsed = async (files, fn) => {
        const res = await Promise.all(files.map((f) => FS.text(f).then((t) => { tick(); return [f, t]; }, (e) => [f, null, e])));
        for (const [f, t, e] of res) { if (t == null) continue; try { fn(f, t); } catch (ex) { fn.bad && fn.bad(f, ex); } }
      };
      const collect = async (dir, depth, test) => { const out = []; await FS.walk(jn(src.rel, dir), depth, (r) => { if (test(lc(r.split("/").pop()))) out.push(r); }); out.sort(); return out; };
      await Promise.all([
        g.mergeCsv(src, "data/hulls/ship_data.csv", g.ships, "id"),
        g.mergeCsv(src, "data/hullmods/hull_mods.csv", g.hullmods, "id"),
        g.mergeCsv(src, "data/hulls/wing_data.csv", g.wings, "id"),
        g.mergeCsv(src, "data/shipsystems/ship_systems.csv", g.systems, "id"),
        g.mergeDescriptions(src),
        g.mergeConfig(src, "data/config/engine_styles.json", g.engineStyles),
        g.mergeConfig(src, "data/config/hull_styles.json", g.hullStyles),
        g.indexSounds(src),
      ]);
      await g.mergeCsv(src, "data/weapons/weapon_data.csv", g.weapons, "id"); // before .wpn files attach to the rows
      const [hulls, variants, wpns, projs, factions, systems] = await Promise.all([
        collect("data/hulls", 3, (n) => n.endsWith(".ship") || n.endsWith(".skin")),
        collect("data/variants", 6, (n) => n.endsWith(".variant")),
        collect("data/weapons", 1, (n) => n.endsWith(".wpn")),
        collect("data/weapons/proj", 3, (n) => n.endsWith(".proj")),
        collect("data/world/factions", 1, (n) => n.endsWith(".faction") || n === "default_ship_roles.json"),
        collect("data/shipsystems", 1, (n) => n.endsWith(".system")),
      ]);
      const hullFn = (f, t) => { const j = Json.obj(Json.parse(t)); if (j) g.putHull(src, f, j); };
      hullFn.bad = (f, ex) => g.warnings.push(src.id + ": unreadable " + f.slice(jn(src.rel, "data/hulls").length + 1) + ": " + ex.message);
      await Promise.all([
        parsed(hulls, hullFn),
        parsed(variants, (f, t) => { const j = Json.obj(Json.parse(t)); if (j && j.variantId != null) g.putVariant(src, f, j); }),
        parsed(wpns, (f, t) => {
          const j = Json.obj(Json.parse(t)); if (!j || j.id == null) return;
          let row = g.weapons.get(str(j.id));
          if (!row) { row = { id: str(j.id), _wpnOnly: true }; g.weapons.set(str(j.id), row); }
          setWpn(row, f, j);
        }),
        parsed(projs, (f, t) => { const j = Json.obj(Json.parse(t)); if (j && j.id != null) g.projFiles.set(str(j.id), { path: abs(f), source: src.id }); }),
        parsed(systems, (f, t) => { const j = Json.obj(Json.parse(t)); if (j && j.id != null) g.systemFiles.set(str(j.id), { path: abs(f), source: src.id }); }),
        (async () => {
          const res = await Promise.all(factions.map((f) => FS.text(f).then((t) => [f, t], (e) => [f, null, e])));
          for (const [f, t, e] of res) {
            const n = f.split("/").pop();
            try {
              if (t == null) throw e;
              const j = Json.obj(Json.parse(t)); if (!j) continue;
              if (lc(n).endsWith(".faction")) {
                const key = "data/world/factions/" + n;
                if (!g.factionParts.has(key)) g.factionParts.set(key, []);
                g.factionParts.get(key).push({ source: src.id, path: abs(f), json: j });
              } else for (const k of Object.keys(j)) { const m = Json.obj(j[k]); if (m) { if (!g.roles.has(k)) g.roles.set(k, {}); Object.assign(g.roles.get(k), m); } }
            } catch (ex) { g.warnings.push(src.id + ": unreadable " + n + ": " + ex.message); }
          }
        })(),
      ]);
      return g;
    }

    async mergeCsv(src, rel, into, key) {
      const p = jn(src.rel, rel);
      if (!(await FS.isFile(p))) return;
      try {
        const text = await FS.text(p), file = abs(await FS.real(p));
        for (const r of Csv.records(text, key)) {
          const id = r[key].trim();
          const e = Object.assign({}, r, { _source: src.id, _file: file });
          const prev = into.get(id);
          if (prev) e._overrides = [...(Json.arr(prev._overrides) || []), prev._source];
          into.set(id, e);
        }
      } catch (ex) { this.warnings.push(src.id + ": could not read " + rel + ": " + ex.message); }
    }
    async mergeDescriptions(src) {
      const p = jn(src.rel, "data/strings/descriptions.csv");
      if (!(await FS.isFile(p))) return;
      try { for (const r of Csv.records(await FS.text(p), "id")) this.descriptions.set((r.type != null ? r.type : "") + ":" + r.id.trim(), Object.assign({}, r)); }
      catch (ex) { this.warnings.push(src.id + ": could not read descriptions.csv: " + ex.message); }
    }
    async mergeConfig(src, rel, into) {
      const p = jn(src.rel, rel);
      if (!(await FS.isFile(p))) return;
      try { const m = await readJson(p); if (m) Object.assign(into, m); }
      catch (ex) { this.warnings.push(src.id + ": could not read " + rel + ": " + ex.message); }
    }
    async indexSounds(src) {
      const p = jn(src.rel, "data/config/sounds.json");
      if (!(await FS.isFile(p))) return;
      try { this.collectSounds(await readJson(p), src); }
      catch (ex) { this.warnings.push(src.id + ": could not read sounds.json: " + ex.message); }
    }
    collectSounds(m, src) {
      if (!m) return;
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (Json.obj(v)) { this.collectSounds(v, src); continue; }
        const l = Json.arr(v); if (!l) continue;
        const files = [];
        for (const o of l) { const f = Json.obj(o); if (!f || f.file == null || f.source != null) continue; files.push(Object.assign({}, f, { mod: src.id })); }
        if (files.length) this.sounds.set(k, files);
      }
    }
    putHull(src, f, j) {
      const skin = lc(f).endsWith(".skin");
      const id = str(j[skin ? "skinHullId" : "hullId"]);
      if (id == null) return;
      const e = { hullId: id, kind: skin ? "skin" : "ship", path: abs(f), source: src.id, hullName: str(j.hullName), hullSize: str(j.hullSize), spriteName: str(j.spriteName) };
      if (skin) e.baseHullId = str(j.baseHullId);
      this.hullFiles.set(id, e);
      this.hullRefs.set(id, hullRefsOf(j));
    }
    putVariant(src, f, j) {
      const id = str(j.variantId);
      this.variants.set(id, { variantId: id, hullId: str(j.hullId), displayName: str(j.displayName), path: abs(f), source: src.id });
      this.variantRefs.set(id, variantRefsOf(j));
    }
    async attachHullmodExport() {
      const p = jn(this.commonRel, "forge_bridge/hullmods.json.data");
      if (!(await FS.isFile(p))) return;
      try {
        const root = await readJson(p), all = Json.obj(root && root.hullmods);
        for (const k of Object.keys(all || {})) { const hm = this.hullmods.get(k), ex = Json.obj(all[k]); if (hm && ex) hm._params = ex.params; }
      } catch (e) { this.warnings.push("Could not read hullmod export: " + e.message); }
    }

    sourceIndex(id) { return this.sources.findIndex((s) => s.id === id); }
    sourceOf(rel) { let best = null; for (const s of this.sources) if (rel === s.rel || rel.startsWith(s.rel + "/") || s.rel === "") best = s; return best; }
    isWritable(rel) { return !!this.modsRel && (rel === this.modsRel || rel.startsWith(this.modsRel + "/")); }

    /** After a CSV row is saved, make the in-memory data match (keeps editor-only "_" fields). */
    updateRow(kind, row, rel) {
      const m = { weapons: this.weapons, wings: this.wings, ships: this.ships, hullmods: this.hullmods, systems: this.systems }[kind];
      const src = this.sourceOf(rel);
      if (kind === "descriptions") { this.descriptions.set(row.type + ":" + row.id, Object.assign({}, row)); return; }
      if (!m || row.id == null) return;
      const id = String(row.id), prev = m.get(id), e = {};
      for (const k of Object.keys(row)) if (!k.startsWith("_")) e[k] = row[k];
      if (prev) for (const k of Object.keys(prev)) if (k.startsWith("_")) e[k] = prev[k];
      e._source = src ? src.id : "?"; e._file = abs(rel);
      m.set(id, e);
    }

    /** Re-reads one saved file so the indexes reflect it without a full reload. */
    async reindex(rel) {
      const src = this.sourceOf(rel);
      if (!src) return;
      const n = lc(rel.split("/").pop());
      let j;
      try { j = await readJson(rel); } catch (e) { return; }
      if (!j) return;
      if (n.endsWith(".variant") && j.variantId != null) this.putVariant(src, rel, j);
      else if (n.endsWith(".wpn") && j.id != null) { const row = this.weapons.get(str(j.id)); if (row) setWpn(row, rel, j); }
      else if (n.endsWith(".proj") && j.id != null) this.projFiles.set(str(j.id), { path: abs(rel), source: src.id });
      else if (n.endsWith(".ship") || n.endsWith(".skin")) this.putHull(src, rel, j);
      else if (n.endsWith(".faction")) {
        const key = rel.slice(src.rel ? src.rel.length + 1 : 0);
        if (!this.factionParts.has(key)) this.factionParts.set(key, []);
        const ps = this.factionParts.get(key).filter((x) => x.source !== src.id);
        const part = { source: src.id, path: abs(rel), json: j };
        let at = 0;
        for (let k = 0; k < ps.length; k++) if (this.sourceIndex(ps[k].source) < this.sourceIndex(src.id)) at = k + 1;
        ps.splice(at, 0, part);
        this.factionParts.set(key, ps);
      } else if (n === "default_ship_roles.json") {
        for (const k of Object.keys(j)) { const m = Json.obj(j[k]); if (m) { if (!this.roles.has(k)) this.roles.set(k, {}); Object.assign(this.roles.get(k), m); } }
      } else if (n.endsWith(".system") && j.id != null) this.systemFiles.set(str(j.id), { path: abs(rel), source: src.id });
    }

    factionsSummary() {
      const out = [];
      const lists = [["knownShips", "hulls"], ["priorityShips", "hulls"], ["knownWeapons", "weapons"], ["priorityWeapons", "weapons"],
        ["knownFighters", "fighters"], ["priorityFighters", "fighters"], ["knownHullMods", "hullMods"]];
      for (const key of [...this.factionParts.keys()].sort()) {
        const f = { rel: key }, parts = [];
        for (const part of this.factionParts.get(key)) {
          const j = part.json;
          if (j.id != null && f.id == null) f.id = j.id;
          if (j.displayName != null) f.name = j.displayName;
          if (j.color != null) f.color = j.color;
          for (const [k, sub2] of lists) {
            const blk = Json.obj(j[k]); if (!blk) continue;
            const acc = f[k] || (f[k] = {});
            for (const sub of ["tags", sub2]) { const l = acc[sub] || (acc[sub] = []); for (const o of Json.arr(blk[sub]) || []) if (o != null) l.push(String(o)); }
          }
          parts.push({ source: part.source, path: part.path });
        }
        if (f.id == null) f.id = key.replace(/^.*\/|\.faction$/g, "");
        f.parts = parts;
        out.push(f);
      }
      return out;
    }

    async moduleParents(hullId) {
      const out = [];
      for (const [vid, refs] of this.variantRefs) {
        if (!refs.modules.some((mv) => { const v = this.variants.get(mv); return v && v.hullId === hullId; })) continue;
        const pv = this.variants.get(vid); if (!pv) continue;
        try {
          const j = await readJson(toRel(pv.path));
          const mods = Json.arr(j.modules);
          const pairs = mods ? mods.map(Json.obj).filter(Boolean) : Json.obj(j.modules) ? [j.modules] : [];
          for (const m of pairs) for (const slot of Object.keys(m)) {
            const mv = this.variants.get(String(m[slot]));
            if (!mv || mv.hullId !== hullId) continue;
            out.push({ parentVariant: vid, parentHull: pv.hullId, parentSource: pv.source, slot, moduleVariant: String(m[slot]) });
          }
        } catch (e) { /* unreadable parent variant */ }
      }
      return out;
    }

    usage(kind, id) {
      const out = [];
      const use = (type, id2, label, source, path, detail) => ({ type, id: id2, label, source: source == null ? null : source, path: path == null ? null : path, detail });
      const key = { weapon: "weapons", hullmod: "mods", wing: "wings" }[kind];
      if (key) {
        for (const [vid, r] of this.variantRefs) {
          const n = r[key].filter((x) => x === id).length; if (!n) continue;
          const v = this.variants.get(vid); if (!v) continue;
          out.push(use("variant", vid, str(v.hullId), v.source, v.path, n > 1 ? n + "×" : ""));
        }
        for (const [hid, r] of this.hullRefs) {
          const n = r[key].filter((x) => x === id).length; if (!n) continue;
          const h = this.hullFiles.get(hid);
          out.push(use("built-in", hid, hid, h && h.source, h && h.path, n > 1 ? n + "×" : ""));
        }
      }
      if (kind === "weapon") for (const w of this.wings.values()) {
        const r = this.variantRefs.get(str(w.variant));
        if (r && r.weapons.includes(id)) out.push(use("wing", str(w.id), str(w.variant), w._source, w._file, "fighter loadout"));
      }
      if (kind === "system") for (const r of this.ships.values()) {
        if (id === str(r["system id"])) out.push(use("hull", str(r.id), str(r.name), r._source, r._file, "ship system"));
        if (id === str(r["defense id"])) out.push(use("hull", str(r.id), str(r.name), r._source, r._file, "defense (shield/phase)"));
      }
      if (kind === "hull") {
        for (const v of this.variants.values()) if (v.hullId === id) out.push(use("variant", v.variantId, v.displayName, v.source, v.path, ""));
        for (const h of this.hullFiles.values()) if (h.baseHullId === id) out.push(use("skin", h.hullId, h.hullName, h.source, h.path, ""));
        for (const w of this.wings.values()) { const v = this.variants.get(str(w.variant)); if (v && v.hullId === id) out.push(use("wing", str(w.id), str(w.variant), w._source, w._file, "fighter hull")); }
        for (const [vid, r] of this.variantRefs) for (const mv of r.modules) {
          const v = this.variants.get(mv);
          if (v && v.hullId === id) { const pv = this.variants.get(vid); out.push(use("module of", vid, pv ? str(pv.hullId) : "", pv && pv.source, pv && pv.path, mv)); }
        }
      }
      const fk = kind === "hull" ? [["knownShips", "hulls"], ["priorityShips", "hulls"]] : kind === "weapon" ? [["knownWeapons", "weapons"], ["priorityWeapons", "weapons"]]
        : kind === "wing" ? [["knownFighters", "fighters"], ["priorityFighters", "fighters"]] : kind === "hullmod" ? [["knownHullMods", "hullMods"]] : [];
      if (fk.length) for (const f of this.factionsSummary()) for (const [k, sub] of fk) {
        const blk = Json.obj(f[k]), l = blk && Json.arr(blk[sub]);
        if (l && l.includes(id)) out.push(use("faction", str(f.id), str(f.name), null, null, k));
      }
      if (kind === "hull") for (const [role, m] of this.roles) for (const vid of Object.keys(m)) {
        const v = this.variants.get(vid);
        if (v && v.hullId === id) out.push(use("role", role, vid, null, null, "weight " + numText(m[vid])));
      }
      return out;
    }

    /** Game-relative asset path (e.g. graphics/ships/x.png) -> real relative path, mods overriding core. */
    async resolveAsset(rel) {
      rel = String(rel).replace(/\\/g, "/").replace(/^\/+/, "");
      if (rel.includes("..")) return null;
      for (let k = this.sources.length - 1; k >= 0; k--) { const p = jn(this.sources[k].rel, rel); if (await FS.isFile(p)) return p; }
      return null;
    }

    async images() {
      if (this.imageIndex) return this.imageIndex;
      const winner = new Map(); // lower-case rel -> [rel, sourceIndex]
      const ids = this.sources.map((s) => s.id);
      const found = await Promise.all(this.sources.map(async (s) => {
        const list = [];
        await FS.walk(jn(s.rel, "graphics"), null, (r) => { if (/\.(png|jpe?g)$/i.test(r)) list.push(s.rel ? r.slice(s.rel.length + 1) : r); });
        return list;
      }));
      found.forEach((list, si) => { for (const r of list) winner.set(lc(r), [r, si]); });
      const files = [...winner.values()].sort((a, b) => (lc(a[0]) < lc(b[0]) ? -1 : lc(a[0]) > lc(b[0]) ? 1 : 0));
      this.imageIndex = { sources: ids, files };
      return this.imageIndex;
    }
  }
  /** Java writes whole-number doubles without ".0" in JSON but String.valueOf gives "1.0": match what users saw. */
  const numText = (v) => (typeof v === "number" ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : String(v));

  function setWpn(row, rel, j) {
    row._wpn = abs(rel); row._size = str(j.size); row._mountType = str(j.type); row._turretSprite = str(j.turretSprite); row._hardpointSprite = str(j.hardpointSprite);
  }
  const WPN_KEYS = ["_wpn", "_size", "_mountType", "_turretSprite", "_hardpointSprite"];
  function absorb(from, into) {
    for (const [id, row] of from) {
      const prev = into.get(id);
      if (row._wpnOnly) {
        if (prev) { for (const k of WPN_KEYS) if (k in row) prev[k] = row[k]; }
        else into.set(id, row);
        continue;
      }
      if (prev && prev._wpnOnly) {
        for (const k of Object.keys(prev)) if (k.startsWith("_") && !(k in row)) row[k] = prev[k];
        delete row._wpnOnly;
        into.set(id, row);
        continue;
      }
      if (prev) {
        row._overrides = [...(Json.arr(prev._overrides) || []), prev._source];
        for (const k of WPN_KEYS) if (!(k in row) && k in prev) row[k] = prev[k];
      }
      into.set(id, row);
    }
  }
  const strs = (a) => (Json.arr(a) || []).filter((o) => o != null).map(String);
  function variantRefsOf(j) {
    const w = [], mo = [];
    for (const g of Json.arr(j.weaponGroups) || []) { const ws = Json.obj(g) && Json.obj(g.weapons); if (ws) for (const k of Object.keys(ws)) if (ws[k] != null) w.push(String(ws[k])); }
    for (const o of Json.arr(j.modules) || []) { const om = Json.obj(o); if (om) for (const k of Object.keys(om)) mo.push(String(om[k])); }
    return { weapons: w, mods: [...strs(j.hullMods), ...strs(j.sMods), ...strs(j.permaMods)], wings: strs(j.wings), modules: mo };
  }
  function hullRefsOf(j) {
    const w = [], bw = Json.obj(j.builtInWeapons);
    if (bw) for (const k of Object.keys(bw)) if (bw[k] != null) w.push(String(bw[k]));
    return { mods: strs(j.builtInMods), weapons: w, wings: strs(j.builtInWings) };
  }
  L.GameData = GameData; L.scanMods = scanMods; L.compareVersions = compareVersions;
  L.readJson = readJson; L.jn = jn;
})();
