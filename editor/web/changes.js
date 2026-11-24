// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Pending-changes list. Every edit is turned into a pending file write (shown with a diff); nothing is written
// until "Save all". Loaded last; relies on app.js and editors.js.

const CH = { entries: new Map(), timer: null, syncing: null, open: false, previews: new Map(), expanded: new Set() };
let UID = 0;
const newUid = (p) => p + ++UID;

// Docs stay registered while they have pending changes, so closing a tab or switching weapons loses nothing.
S.shipDocs = {}; S.weaponDocs = {}; S.wingDocs = {};

function scheduleSync() {
  clearTimeout(CH.timer);
  CH.timer = setTimeout(() => syncAll(), 300);
}
async function flushSync() { clearTimeout(CH.timer); await syncAll(); }

/** Rebuilds the pending entries for every open/edited document. */
async function syncAll() {
  if (CH.syncing) { await CH.syncing; }
  CH.syncing = (async () => {
    for (const c of Object.values(S.shipDocs)) await syncShip(c);
    for (const w of Object.values(S.weaponDocs)) await syncWeapon(w);
    for (const g of Object.values(S.wingDocs)) await syncWing(g);
    for (const f of CH.syncers || []) await f();
  })();
  await CH.syncing; CH.syncing = null;
  renderChangesBadge();
  if (CH.open) renderChanges();
  if (S.cur) renderTabs();
  markWeaponDirty(); markWingDirty();
  if (typeof renderWeaponList === "function" && $("#tab-weapons").classList.contains("active")) renderWeaponListMarks();
}

function put(key, e) {
  const prev = CH.entries.get(key);
  const sig = JSON.stringify(e.body) + (e.error || "");
  if (prev && prev.sig === sig) { prev.onSaved = e.onSaved; prev.revert = e.revert; return; }
  e.key = key; e.sig = sig; e.status = null;
  CH.entries.set(key, e);
  CH.previews.delete(key);
}
const drop = (key) => { CH.entries.delete(key); CH.previews.delete(key); };
const pathKey = (b) => (b.path ? b.path : b.root + "/" + b.rel);

/** Resolves the destination quietly (no toast); returns {own, src} or {error}. */
function destination(sourceId, force) {
  const own = sourceById(sourceId);
  if (own && !own.core && !force) return { own: true, src: own };
  const t = sourceById($("#save-target").value);
  if (!t) return { error: "Choose a mod in “Save to mod” (top right): vanilla files are never overwritten." };
  return { own: false, src: t };
}
/** Column-by-column differences between the original row and the edited one. */
function fieldChanges(orig, row) {
  if (!orig) return null;
  const out = [];
  for (const k of new Set([...Object.keys(orig), ...Object.keys(row)])) {
    if (k.startsWith("_")) continue;
    const a = orig[k] ?? "", b = row[k] ?? "";
    if (String(a) !== String(b)) out.push([k, a, b]);
  }
  return out;
}
async function csvEntry(kind, row, rel, keys, force, orig) {
  const d = destination(row._source, force);
  const fields = fieldChanges(orig, row);
  if (d.error) return { error: d.error, fields, body: { kind, row: stripPriv(row) } };
  const body = { type: "csv", kind, keys, row: stripPriv(row) };
  if (d.own) body.path = row._file; else { body.root = d.src.root; body.rel = rel; }
  const cols = await headerOf(row._file || row._template);
  if (cols) body.columns = cols.map((c) => c.trim()).filter(Boolean);
  return { body, dest: d.src, fields };
}
function jsonEntry(sourceId, path, relIfNew, obj, force) {
  const d = destination(sourceId, force);
  const content = prettyJson(obj);
  if (d.error) return { error: d.error, body: { content } };
  return { body: d.own ? { type: "json", path, content } : { type: "json", root: d.src.root, rel: relIfNew, content }, dest: d.src };
}

// ---------------------------------------------------------------- ships
async function syncShip(c) {
  const name = tabName(c), owner = "Ship: " + name + (c.isNew ? " (new)" : ""), force = !!c.isNew;
  // ship_data.csv row (skins have none)
  const kStats = c.uid + ":stats";
  if (!c.isSkin && (force || JSON.stringify(c.csv) !== c.csvOrig) && c.csv.id) {
    const snap = JSON.stringify(c.csv);
    const e = await csvEntry("ships", c.csv, "data/hulls/ship_data.csv", ["id"], force, force ? null : JSON.parse(c.csvOrig));
    put(kStats, Object.assign(e, { owner, ownerKey: c.uid, label: `Stats row “${c.csv.id}” in ship_data.csv`,
      onSaved: (r) => { c.csv._source = r.source; c.csv._file = r.path; c.csvOrig = JSON.stringify(c.csv); void snap; },
      revert: () => { c.csv = JSON.parse(c.csvOrig); } }));
  } else drop(kStats);
  // .ship or .skin file
  const kHull = c.uid + ":hull";
  const skinOut = c.isSkin ? buildSkin(c) : null;
  const hullDirty = c.isSkin ? (JSON.stringify(c.ship) !== c.shipOrig || JSON.stringify(c.skin) !== c.skinOrig) : JSON.stringify(c.ship) !== c.shipOrig;
  if (force || hullDirty) {
    const snapShip = JSON.stringify(c.ship), snapSkin = c.skin ? JSON.stringify(c.skin) : null;
    const rel = c.isSkin ? "data/hulls/skins/" + (c.file.path ? fileName(c.file.path) : c.id + ".skin") : "data/hulls/" + (c.file.path ? fileName(c.file.path) : c.id + ".ship");
    const e = jsonEntry(c.file.source, c.file.path, rel, c.isSkin ? skinOut : c.ship, force);
    put(kHull, Object.assign(e, { owner, ownerKey: c.uid, label: (c.isSkin ? "Skin file " : "Hull file ") + fileName(rel),
      onSaved: (r) => {
        c.shipOrig = snapShip; if (c.isSkin) { c.skin = skinOut; c.skinOrig = JSON.stringify(skinOut); void snapSkin; }
        c.file.path = r.path; c.file.source = r.source;
        const h = S.hullById[c.id]; if (h) { h.source = r.source; h.path = r.path; }
      },
      revert: () => { c.ship = JSON.parse(c.shipOrig); if (c.isSkin) c.skin = JSON.parse(c.skinOrig); loadShipSprite(c); } }));
  } else drop(kHull);
  // description (descriptions.csv, type SHIP)
  const kDesc = c.uid + ":desc";
  if (c.desc && (force || JSON.stringify(c.desc) !== c.descOrig)) {
    const d = Object.assign({}, c.desc, { id: c.id, type: "SHIP" });
    const e = await csvEntry("descriptions", d, "data/strings/descriptions.csv", ["id", "type"], force || !d._file, c.descOrig !== "null" ? JSON.parse(c.descOrig) : null);
    put(kDesc, Object.assign(e, { owner, ownerKey: c.uid, label: `Description for “${c.id}” in descriptions.csv`,
      onSaved: (r) => { c.desc._source = r.source; c.desc._file = r.path; c.descOrig = JSON.stringify(c.desc); },
      revert: () => { c.desc = JSON.parse(c.descOrig); } }));
  } else drop(kDesc);
  // uploaded sprite
  const kSpr = c.uid + ":sprite";
  if (c.spriteUpload && c.spriteUpload.rel === spriteOf(c)) {
    const up = c.spriteUpload, dd = destination(null, true);
    const e = dd.error ? { error: dd.error, body: {} } : { body: { type: "json", root: dd.src.root, rel: up.rel, base64: up.base64 }, dest: dd.src };
    put(kSpr, Object.assign(e, { owner, ownerKey: c.uid, label: `Sprite image ${up.rel}`,
      onSaved: () => { c.spriteUpload = null; },
      revert: () => {} }));
  } else drop(kSpr);
  // .variant file
  const kVar = c.uid + ":variant";
  if (c.variant && JSON.stringify(c.variant) !== c.variantOrig) {
    const v = c.variant, snap = JSON.stringify(v);
    const orig = JSON.parse(c.variantOrig || "null");
    const sameFile = c.variantFile && orig && orig.variantId === v.variantId;
    const clean = Object.assign({}, v, { wings: (v.wings || []).filter(Boolean) });
    if (clean.modules && !clean.modules.length) delete clean.modules;
    const e = v.variantId
      ? jsonEntry(sameFile ? c.variantFile.source : null, sameFile ? c.variantFile.path : null, "data/variants/" + v.variantId + ".variant", clean, !sameFile)
      : { error: "The variant needs an id.", body: {} };
    put(kVar, Object.assign(e, { owner, ownerKey: c.uid, label: `Variant ${v.variantId || "(no id)"}${sameFile ? "" : " (new file)"}`,
      onSaved: (r) => {
        c.variantOrig = snap;
        const entry = { variantId: v.variantId, hullId: v.hullId, displayName: v.displayName, path: r.path, source: r.source };
        c.variants = c.variants.filter((x) => x.path !== r.path).concat([entry]).sort((a, b) => a.variantId.localeCompare(b.variantId));
        c.variantFile = entry;
        if (S.allVariants) S.allVariants[v.variantId] = entry;
      },
      revert: () => { if (c.variantOrig && c.variantOrig !== "null") c.variant = JSON.parse(c.variantOrig); } }));
  } else drop(kVar);
}

// ---------------------------------------------------------------- weapons
function weaponParts(w) {
  return {
    row: w.isNew || JSON.stringify(stripPriv(w.row)) !== w.rowOrig,
    wpn: w.isNew || JSON.stringify(w.wpn) !== w.wpnOrig,
    desc: !!w.desc && (w.isNew || JSON.stringify(w.desc) !== w.descOrig),
    proj: !!w.proj && JSON.stringify(w.proj) !== w.projOrig,
  };
}
async function syncWeapon(w) {
  const p = weaponParts(w), owner = "Weapon: " + (w.row.name || w.id), force = w.isNew;
  const refreshList = () => {
    S.weapons[w.row.id] = Object.assign(S.weapons[w.row.id] || {}, clone(w.row), {
      _wpn: w.wpnPath, _size: w.wpn.size, _mountType: w.wpn.type, _turretSprite: w.wpn.turretSprite, _hardpointSprite: w.wpn.hardpointSprite,
    });
  };
  const k = (x) => w.uid + ":" + x;
  if (p.row && w.row.id) {
    const snap = JSON.stringify(stripPriv(w.row));
    const e = await csvEntry("weapons", w.row, "data/weapons/weapon_data.csv", ["id"], force, w.rowOrig ? JSON.parse(w.rowOrig) : null);
    put(k("row"), Object.assign(e, { owner, ownerKey: w.uid, label: `Row “${w.row.id}” in weapon_data.csv`,
      onSaved: (r) => { w.row._source = r.source; w.row._file = r.path; w.rowOrig = snap; w.isNew = false; refreshList(); },
      revert: () => { const priv = Object.fromEntries(Object.entries(w.row).filter(([x]) => x.startsWith("_"))); w.row = Object.assign(JSON.parse(w.rowOrig || "{}"), priv); } }));
  } else drop(k("row"));
  if (p.wpn) {
    const snap = JSON.stringify(w.wpn), fname = force || !w.wpnPath ? w.id + ".wpn" : fileName(w.wpnPath);
    const e = jsonEntry(w.wpnSource, w.wpnPath, "data/weapons/" + fname, w.wpn, force);
    put(k("wpn"), Object.assign(e, { owner, ownerKey: w.uid, label: `Weapon file ${fname}`,
      onSaved: (r) => { w.wpnPath = r.path; w.wpnSource = r.source; w.wpnOrig = snap; refreshList(); },
      revert: () => { if (w.wpnOrig) { w.wpn = JSON.parse(w.wpnOrig); w.imgs = {}; } } }));
  } else drop(k("wpn"));
  if (p.desc) {
    const d = Object.assign({}, w.desc, { id: w.id, type: "WEAPON" }), snap = JSON.stringify(w.desc);
    const e = await csvEntry("descriptions", d, "data/strings/descriptions.csv", ["id", "type"], force || !d._file, w.descOrig ? JSON.parse(w.descOrig) : null);
    put(k("desc"), Object.assign(e, { owner, ownerKey: w.uid, label: `Description for “${w.id}” in descriptions.csv`,
      onSaved: (r) => { w.desc._source = r.source; w.desc._file = r.path; w.descOrig = JSON.stringify(w.desc); },
      revert: () => { w.desc = JSON.parse(w.descOrig || "null"); } }));
    void snap;
  } else drop(k("desc"));
  if (p.proj) {
    const snap = JSON.stringify(w.proj);
    const e = jsonEntry(w.projSource, w.projPath, "data/weapons/proj/" + fileName(w.projPath || w.wpn.projectileSpecId + ".proj"), w.proj);
    put(k("proj"), Object.assign(e, { owner, ownerKey: w.uid, label: `Projectile file ${fileName(w.projPath || (w.wpn.projectileSpecId || "projectile") + ".proj")}${w.projPath ? "" : " (new)"}`,
      onSaved: (r) => { w.projPath = r.path; w.projSource = r.source; w.projOrig = snap; },
      revert: () => { w.proj = JSON.parse(w.projOrig); } }));
  } else drop(k("proj"));
}

// ---------------------------------------------------------------- wings
async function syncWing(g) {
  const owner = "Wing: " + g.row.id, k = (x) => g.uid + ":" + x;
  if ((g.isNew || JSON.stringify(stripPriv(g.row)) !== g.rowOrig) && g.row.id) {
    const snap = JSON.stringify(stripPriv(g.row));
    const e = await csvEntry("wings", g.row, "data/hulls/wing_data.csv", ["id"], g.isNew, g.rowOrig ? JSON.parse(g.rowOrig) : null);
    put(k("row"), Object.assign(e, { owner, ownerKey: g.uid, label: `Row “${g.row.id}” in wing_data.csv`,
      onSaved: (r) => {
        g.row._source = r.source; g.row._file = r.path; g.rowOrig = snap;
        if (g.isNew && !S.wings.includes(g.row)) S.wings.push(g.row);
        g.isNew = false; S.wingById[g.row.id] = g.row;
      },
      revert: () => { const priv = Object.fromEntries(Object.entries(g.row).filter(([x]) => x.startsWith("_"))); g.row = Object.assign(JSON.parse(g.rowOrig || "{}"), priv); } }));
  } else drop(k("row"));
  if (g.hull && JSON.stringify(stripPriv(g.hull)) !== g.hullOrig) {
    const snap = JSON.stringify(stripPriv(g.hull));
    const e = await csvEntry("ships", g.hull, "data/hulls/ship_data.csv", ["id"], false, JSON.parse(g.hullOrig));
    put(k("hull"), Object.assign(e, { owner, ownerKey: g.uid, label: `Fighter hull row “${g.hull.id}” in ship_data.csv`,
      onSaved: (r) => { g.hull._source = r.source; g.hull._file = r.path; g.hullOrig = snap; },
      revert: () => { const priv = Object.fromEntries(Object.entries(g.hull).filter(([x]) => x.startsWith("_"))); g.hull = Object.assign(JSON.parse(g.hullOrig), priv); } }));
  } else drop(k("hull"));
}

// ---------------------------------------------------------------- review dialog
function renderChangesBadge() {
  const n = CH.entries.size, b = $("#open-changes");
  b.textContent = n ? `Changes (${n})` : "Changes";
  b.classList.toggle("has", n > 0);
}
async function openChanges() {
  await flushSync();
  CH.open = true;
  $("#changes").classList.remove("hidden");
  renderChanges();
}
function closeChanges() { CH.open = false; $("#changes").classList.add("hidden"); }

function renderChanges() {
  const list = [...CH.entries.values()];
  const groups = {};
  for (const e of list) (groups[e.owner] = groups[e.owner] || []).push(e);
  const blocked = list.filter((e) => e.error).length;
  $("#changes-title").textContent = list.length ? `${list.length} pending change${list.length > 1 ? "s" : ""}` : "No pending changes";
  $("#changes-save").disabled = !list.length || blocked === list.length;
  $("#changes-discard").disabled = !list.length;
  $("#changes-body").innerHTML = list.length ? Object.entries(groups).map(([owner, es]) => `
    <div class="ch-group"><div class="ch-owner">${esc(owner)}</div>
      ${es.map((e) => {
        const pv = CH.previews.get(e.key);
        const dest = e.body.path || (e.body.root ? e.body.root + "/" + e.body.rel : "");
        const action = e.error ? `<span class="badge bad">blocked</span>`
          : pv ? `<span class="badge ${pv.exists ? "restart" : "live"}">${esc(actionLabel(e, pv))}</span>${pv.backup ? '<span class="badge" title="A copy of the current file is kept in Starforge/backups before saving">+ backup</span>' : ""}` : '<span class="muted">…</span>';
        const stats = pv && !pv.err && !pv.binary ? diffStats(pv) : null;
        return `<div class="ch-entry${e.status === "ok" ? " ok" : ""}" data-key="${esc(e.key)}">
          <div class="ch-row">
            <button class="ch-toggle" data-toggle="${esc(e.key)}">${CH.expanded.has(e.key) ? "▾" : "▸"}</button>
            <div class="grow"><div><b>${esc(e.label)}</b> ${action}${stats ? ` <span class="add">+${stats.add}</span> <span class="del">−${stats.del}</span>` : ""}</div>
              <div class="muted" style="font-size:11px;word-break:break-all">${e.error ? esc(e.error) : esc((e.dest ? e.dest.name + " · " : "") + dest)}</div>
              ${e.fields && e.fields.length ? `<div class="ch-fields">${e.fields.map(([k, a, b]) => `<span><b>${esc(k)}</b>: <span class="del">${esc(String(a).slice(0, 60)) || "∅"}</span> → <span class="add">${esc(String(b).slice(0, 60)) || "∅"}</span></span>`).join("")}</div>` : ""}
              ${e.status && e.status !== "ok" ? `<div class="del" style="font-size:12px">${esc(e.status)}</div>` : ""}</div>
            <button data-discard="${esc(e.key)}" title="Undo this change in the editor and remove it from the list">Discard</button>
          </div>
          ${CH.expanded.has(e.key) ? `<div class="ch-diff">${pv ? (pv.err ? esc(pv.err) : renderDiff(pv)) : "Loading…"}</div>` : ""}
        </div>`;
      }).join("")}</div>`).join("")
    : '<p class="muted" style="padding:12px">Edits you make in any tab show up here automatically. Nothing is written to disk until you click Save all.</p>';
  for (const e of list) if (!e.error && !CH.previews.has(e.key)) loadPreview(e);
}
function actionLabel(e, pv) {
  if (pv.binary) return (pv.exists ? "overwrite image" : "new image") + ` (${Math.round(pv.bytes / 1024)} KB)`;
  if (e.body.type === "csv") return pv.created ? "new CSV file" : pv.action === "replaced" ? "replace row" : "add row";
  return pv.exists ? "overwrite file" : "new file";
}
async function loadPreview(e) {
  CH.previews.set(e.key, null);
  try { CH.previews.set(e.key, await api("/api/preview", e.body)); }
  catch (err) { CH.previews.set(e.key, { err: String(err.message || err) }); }
  if (CH.open) renderChanges();
}

// ---- line diff (common prefix/suffix trimmed, LCS on the middle)
function lineDiff(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb), ops = [];
  for (let i = 0; i < s; i++) ops.push([" ", a[i]]);
  if (A.length * B.length > 4e6) { A.forEach((l) => ops.push(["-", l])); B.forEach((l) => ops.push(["+", l])); }
  else {
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (A[i] === B[j]) { ops.push([" ", A[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(["-", A[i++]]); else ops.push(["+", B[j++]]); }
    while (i < n) ops.push(["-", A[i++]]); while (j < m) ops.push(["+", B[j++]]);
  }
  for (let i = ea; i < a.length; i++) ops.push([" ", a[i]]);
  return ops;
}
const splitLines = (t) => (t ? t.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n") : []);
function diffStats(pv) {
  if (!pv.ops) pv.ops = lineDiff(splitLines(pv.oldText), splitLines(pv.newText));
  return { add: pv.ops.filter((o) => o[0] === "+").length, del: pv.ops.filter((o) => o[0] === "-").length };
}
function renderDiff(pv) {
  diffStats(pv);
  const ops = pv.ops, ctx = 3, show = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o[0] !== " ") for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) show[k] = true; });
  if (pv.binary) return `<div class="muted" style="padding:6px 10px">Image file, ${Math.round(pv.bytes / 1024)} KB${pv.exists ? ` (replaces ${Math.round(pv.oldBytes / 1024)} KB)` : ""}.</div>`;
  if (!ops.some((o) => o[0] !== " ")) return '<span class="muted">No differences from the file on disk.</span>';
  let out = "", gap = false, oldN = 0, newN = 0;
  ops.forEach((o, i) => {
    if (o[0] !== "+") oldN++; if (o[0] !== "-") newN++;
    if (!show[i]) { gap = true; return; }
    if (gap) { out += `<div class="dl gap">⋯</div>`; gap = false; }
    const cls = o[0] === "+" ? "add" : o[0] === "-" ? "del" : "";
    const num = o[0] === "+" ? newN : oldN;
    out += `<div class="dl ${cls}"><span class="ln">${num}</span><span class="sg">${o[0] === " " ? "" : o[0]}</span>${esc(o[1]) || " "}</div>`;
  });
  return out;
}

// ---- actions
async function saveAllChanges() {
  await flushSync();
  const list = [...CH.entries.values()].filter((e) => !e.error);
  if (!list.length) return;
  $("#changes-save").disabled = true;
  let ok = 0, fail = 0;
  // one backup folder per Save all: backups/<date_time>/
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  const batch = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  for (const e of list) {
    const { type, ...body } = e.body;
    body.batch = batch;
    try {
      const r = await api(type === "csv" ? "/api/csvrow" : "/api/save", body);
      r.source = e.dest ? e.dest.id : null;
      e.onSaved(r); e.status = "ok"; ok++;
      drop(e.key);
    } catch (err) { e.status = "Failed: " + (err.message || err); fail++; }
  }
  // A brand-new weapon/wing can only be marked saved once all its parts are written.
  for (const w of Object.values(S.weaponDocs)) if (![...CH.entries.values()].some((e) => e.ownerKey === w.uid)) w.isNew = false;
  for (const c of Object.values(S.shipDocs)) if (c.isNew && ![...CH.entries.values()].some((e) => e.ownerKey === c.uid)) c.isNew = false;
  CH.previews.clear();
  await flushSync();
  if (S.cur) renderDetail();
  if (W) renderWeaponEditor();
  if (WG) renderWingEditor();
  renderWeaponList(); renderWingList();
  toast(fail ? `Saved ${ok}, ${fail} failed — see the Changes list.` : `Saved ${ok} change${ok === 1 ? "" : "s"}.`, !!fail);
  if (!fail && !CH.entries.size) closeChanges(); else renderChanges();
}
function discardEntry(key) {
  const e = CH.entries.get(key);
  if (!e) return;
  e.revert && e.revert();
  drop(key);
  // a new (never saved) weapon/wing with nothing left pending is dropped entirely
  for (const [id, w] of Object.entries(S.weaponDocs)) if (w.isNew && ![...CH.entries.values()].some((x) => x.ownerKey === w.uid)) { delete S.weaponDocs[id]; if (W === w) { W = null; $("#weapon-detail").innerHTML = '<p class="muted">Select a weapon.</p>'; } }
  for (const [id, g] of Object.entries(S.wingDocs)) if (g.isNew && ![...CH.entries.values()].some((x) => x.ownerKey === g.uid)) { delete S.wingDocs[id]; if (WG === g) { WG = null; $("#wing-detail").innerHTML = '<p class="muted">Select a wing.</p>'; } }
  for (const [id, c] of Object.entries(S.shipDocs)) if (c.isNew && ![...CH.entries.values()].some((x) => x.ownerKey === c.uid)) {
    delete S.shipDocs[id]; const i = S.tabs.indexOf(c); if (i >= 0) { S.tabs.splice(i, 1); if (S.cur === c) { S.cur = null; switchTab(S.tabs[0] || null); } }
    S.hulls = S.hulls.filter((h) => h.hullId !== id); delete S.hullById[id]; renderHullList();
  }
  if (S.cur) { loadWeaponImages(); draw(); renderDetail(); }
  if (W) renderWeaponEditor();
  if (WG) renderWingEditor();
  for (const f of CH.afterDiscard || []) f();
  renderChanges(); renderChangesBadge();
}
function discardAll() {
  if (!confirm(`Discard all ${CH.entries.size} pending changes? The editors go back to what's on disk.`)) return;
  for (const k of [...CH.entries.keys()]) discardEntry(k);
}

$("#open-changes").onclick = openChanges;
$("#changes-close").onclick = closeChanges;
$("#changes").onclick = (e) => { if (e.target.id === "changes") closeChanges(); };
$("#changes-save").onclick = saveAllChanges;
$("#changes-discard").onclick = discardAll;
$("#changes-body").addEventListener("click", (e) => {
  const t = e.target.closest("[data-toggle]"), d = e.target.closest("[data-discard]");
  if (t) { const k = t.dataset.toggle; CH.expanded.has(k) ? CH.expanded.delete(k) : CH.expanded.add(k); renderChanges(); }
  if (d) discardEntry(d.dataset.discard);
});
$("#save-target").addEventListener("change", () => { CH.previews.clear(); scheduleSync(); });
window.addEventListener("beforeunload", (e) => { if (CH.entries.size) { e.preventDefault(); e.returnValue = ""; } });

document.head.insertAdjacentHTML("beforeend", `<style>
#open-changes.has { background: #6b4a12; border-color: var(--warn); color: #fff; font-weight: 600; }
.ch-group { margin: 6px 10px 12px; }
.ch-owner { font-weight: 600; color: var(--accent); margin-bottom: 4px; }
.ch-entry { border: 1px solid var(--line); border-radius: 6px; background: var(--panel2); margin-bottom: 6px; }
.ch-entry.ok { opacity: .5; }
.ch-row { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; }
.ch-row .grow { flex: 1; min-width: 0; }
.ch-toggle { padding: 0 6px; }
.ch-diff { border-top: 1px solid var(--line); max-height: 360px; overflow: auto; font: 12px/1.45 Consolas, "Cascadia Mono", monospace; padding: 4px 0; background: #0a0f15; }
.dl { white-space: pre; padding: 0 8px; }
.dl .ln { display: inline-block; width: 42px; color: #56657a; text-align: right; margin-right: 8px; }
.dl .sg { display: inline-block; width: 12px; }
.dl.add { background: #12351f; color: #b7f5c8; } .dl.del { background: #3d1518; color: #ffc4c4; }
.dl.gap { color: #56657a; }
.add { color: var(--good); } .del { color: var(--bad); }
.ch-fields { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; margin-top: 3px; }
.ch-diff .dl { min-width: max-content; }
.badge.bad { background: #4a1d1d; color: var(--bad); }
</style>`);
