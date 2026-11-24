// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Weapon and fighter-wing editors. Loaded after app.js and reuses its helpers ($, esc, api, num, asset,
// clone, toast, prettyJson, sourceById, matches, S, THEME, hexA, openPicker).

// ---------------------------------------------------------------- shared helpers
/** Where a file should be written: its own mod if it already lives in one, otherwise the "Save to mod" choice. */
function writeTarget(sourceId, force) {
  const own = sourceById(sourceId);
  if (own && !own.core && !force) return { own: true, src: own };
  const t = sourceById($("#save-target").value);
  if (!t) { toast("Choose a mod in “Save to mod” (top right) first: vanilla files are never overwritten.", true); return null; }
  return { own: false, src: t };
}
const stripPriv = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_")));
const headerCache = {};
async function headerOf(path) {
  if (!path) return null;
  if (!headerCache[path]) headerCache[path] = await api("/api/csvheader?path=" + encodeURIComponent(path)).catch(() => null);
  return headerCache[path];
}
/** Editable table of CSV columns. `groups` = [[title, [col | [col, label, kind, options]]]]; other columns go under "Other". */
function csvGroups(row, groups, opts = {}) {
  const used = new Set(), out = [];
  const inputFor = (col, kind, options) => {
    const v = row[col] ?? "";
    if (kind === "select") return `<select data-csv="${esc(col)}">${(options.includes(v) ? options : [v].concat(options)).map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (kind === "text") return `<textarea data-csv="${esc(col)}" rows="2">${esc(v)}</textarea>`;
    if (kind === "sprite" && typeof imgFieldHtml === "function") return imgFieldHtml(`<input data-csv="${esc(col)}" value="${esc(v)}">`, v, "graphics");
    return `<input data-csv="${esc(col)}" value="${esc(v)}"${opts.readonly && opts.readonly.includes(col) ? " readonly" : ""}>`;
  };
  for (const [title, cols] of groups) {
    const rows = cols.map((c) => (Array.isArray(c) ? c : [c])).filter(([c]) => c in row || opts.showMissing);
    rows.forEach(([c]) => used.add(c));
    if (rows.length) out.push(`<h3>${esc(title)}</h3><table class="kv">${rows.map(([c, label, kind, options]) =>
      `<tr><td title="${esc(c)}">${esc(label || c)}</td><td>${inputFor(c, kind, options || [])}</td></tr>`).join("")}</table>`);
  }
  const rest = Object.keys(row).filter((k) => !k.startsWith("_") && !used.has(k) && k !== "number" && k.trim());
  if (rest.length) out.push(`<h3>Other columns</h3><table class="kv">${rest.map((c) => `<tr><td>${esc(c)}</td><td>${inputFor(c)}</td></tr>`).join("")}</table>`);
  return out.join("");
}
function bindCsv(root, row, onChange) {
  root.querySelectorAll("[data-csv]").forEach((i) => (i.oninput = i.onchange = () => { row[i.dataset.csv] = i.value; onChange && onChange(i.dataset.csv); scheduleSync(); }));
}
/** "N changes pending" line with a button to the review dialog. */
function pendingLine(uid) {
  const n = [...CH.entries.values()].filter((e) => e.ownerKey === uid).length;
  return n ? `<div class="pending-line"><span class="dirty">${n} pending change${n > 1 ? "s" : ""} (not written yet)</span>
    <button class="review-btn primary">Review & save…</button></div>` : "";
}
const hasPending = (uid) => [...CH.entries.values()].some((e) => e.ownerKey === uid);

// ================================================================ WEAPON EDITOR
const DAMAGE_TYPES = ["KINETIC", "HIGH_EXPLOSIVE", "ENERGY", "FRAGMENTATION", "OTHER"];
const WEAPON_GROUPS = [
  ["General", [["name"], ["id"], ["tier"], ["rarity"], ["base value"], ["OPs", "OP cost"], ["tech/manufacturer"], ["tags"], ["hints"], ["groupTag"]]],
  ["Damage", [["type", "damage type", "select", DAMAGE_TYPES], ["damage/shot"], ["damage/second", "damage/second (beams)"], ["emp"], ["impact"]]],
  ["Firing", [["range"], ["chargeup"], ["chargedown"], ["burst size"], ["burst delay"], ["energy/shot", "flux/shot"], ["energy/second", "flux/second (beams)"]]],
  ["Ammo", [["ammo"], ["ammo/sec"], ["reload size"]]],
  ["Accuracy & tracking", [["turn rate"], ["min spread"], ["max spread"], ["spread/shot"], ["spread decay/sec"], ["autofireAccBonus"], ["extraArcForAI"]]],
  ["Projectile", [["proj speed"], ["launch speed"], ["flight time"], ["proj hitpoints"], ["beam speed"]]],
  ["Tooltip text", [["for weapon tooltip>>"], ["primaryRoleStr"], ["speedStr"], ["trackingStr"], ["turnRateStr"], ["accuracyStr"], ["customPrimary", null, "text"], ["customPrimaryHL"], ["customAncillary", null, "text"], ["customAncillaryHL"], ["noDPSInTooltip"]]],
];
const WPN_FIELDS = [
  ["specClass", ["projectile", "beam", "missile"]], ["type", ["BALLISTIC", "ENERGY", "MISSILE", "COMPOSITE", "HYBRID", "SYNERGY", "UNIVERSAL", "BUILT_IN", "DECORATIVE", "SYSTEM", "STATION_MODULE"]],
  ["size", ["SMALL", "MEDIUM", "LARGE"]], ["barrelMode", ["ALTERNATING", "LINKED", "ALTERNATING_BURST"]],
  ["turretSprite"], ["turretUnderSprite"], ["turretGunSprite"], ["turretGlowSprite"],
  ["hardpointSprite"], ["hardpointUnderSprite"], ["hardpointGunSprite"], ["hardpointGlowSprite"],
  ["projectileSpecId"], ["fireSoundOne"], ["fireSoundTwo"], ["renderHints"],
];
let W = null; // weapon being edited

function weaponDirty() {
  return !!W && (JSON.stringify(stripPriv(W.row)) !== W.rowOrig || JSON.stringify(W.wpn) !== W.wpnOrig ||
    JSON.stringify(W.desc) !== W.descOrig || JSON.stringify(W.proj) !== W.projOrig || W.isNew);
}

async function showWeapon(id) {
  if (S.weaponDocs[id]) { W = S.weaponDocs[id]; markListSelection("#weapon-list", id); renderWeaponEditor(); return; }
  const base = S.weapons[id];
  if (!base) return;
  const row = clone(base);
  const wpn = base._wpn ? await api("/api/file?path=" + encodeURIComponent(base._wpn)).catch(() => null) : null;
  const desc = await api(`/api/description?type=WEAPON&id=${encodeURIComponent(id)}`).catch(() => null);
  const projE = wpn && wpn.projectileSpecId ? await api("/api/proj?id=" + encodeURIComponent(wpn.projectileSpecId)).catch(() => null) : null;
  W = {
    id, row, rowOrig: JSON.stringify(stripPriv(row)), wpn: wpn || { id, specClass: "projectile", type: base._mountType || "BALLISTIC", size: base._size || "SMALL" },
    wpnPath: base._wpn, wpnSource: wpnSourceOf(base._wpn), desc: desc || null, isNew: false,
    proj: projE ? projE.json : null, projPath: projE && projE.path, projSource: projE && projE.source,
    mount: "TURRET", imgs: {}, sel: -1, view: null, uid: newUid("weapon"),
  };
  W.wpnOrig = JSON.stringify(W.wpn); W.descOrig = JSON.stringify(W.desc); W.projOrig = JSON.stringify(W.proj);
  S.weaponDocs[id] = W;
  markListSelection("#weapon-list", id);
  renderWeaponEditor();
}
/** Switches the weapon's projectile to another .proj id (loaded from the game/mods). */
async function loadWeaponProj(w, pid) {
  const e = pid ? await api("/api/proj?id=" + encodeURIComponent(pid)).catch(() => null) : null;
  if (pid && !e) toast(`No projectile "${pid}" found yet; the preview draws a default shot until it exists.`);
  w.proj = e ? e.json : null; w.projPath = e && e.path; w.projSource = e && e.source; w.projOrig = JSON.stringify(w.proj);
  if (W === w) renderWeaponEditor();
  scheduleSync();
}
function markListSelection(list, id) { document.querySelectorAll(list + " .item").forEach((x) => x.classList.toggle("selected", x.dataset.id === id)); }
function renderWeaponListMarks() {
  document.querySelectorAll("#weapon-list .item").forEach((it) => {
    const d = S.weaponDocs[it.dataset.id], on = !!d && hasPending(d.uid), n = it.querySelector(".n"), dot = n && n.querySelector(".pending");
    if (on && !dot) n.insertAdjacentHTML("beforeend", ' <span class="pending">●</span>'); else if (!on && dot) dot.remove();
  });
  document.querySelectorAll("#wing-list .item").forEach((it) => {
    const d = S.wingDocs[it.dataset.id], on = !!d && hasPending(d.uid), n = it.querySelector(".n"), dot = n && n.querySelector(".pending");
    if (on && !dot) n.insertAdjacentHTML("beforeend", ' <span class="pending">●</span>'); else if (!on && dot) dot.remove();
  });
}
function wpnSourceOf(path) {
  if (!path) return null;
  const n = String(path).replace(/\\/g, "/");
  let best = null;
  for (const s of S.sources) { const r = String(s.root).replace(/\\/g, "/"); if (n.startsWith(r + "/") && (!best || r.length > best.root.length)) best = s; }
  return best && best.id;
}

function weaponDerived(r) {
  const n = (k) => num(r[k]);
  const beam = n("damage/second") != null && n("damage/shot") == null;
  const burst = n("burst size") || 1, cycle = (n("chargeup") || 0) + (n("chargedown") || 0) + (burst - 1) * (n("burst delay") || 0);
  const dps = beam ? n("damage/second") : n("damage/shot") != null && cycle > 0 ? (n("damage/shot") * burst) / cycle : null;
  const fps = beam ? n("energy/second") : n("energy/shot") != null && cycle > 0 ? (n("energy/shot") * burst) / cycle : null;
  const eff = dps && fps != null ? fps / dps : null;
  const sus = n("ammo") && n("ammo/sec") && n("damage/shot") ? n("damage/shot") * n("ammo/sec") : null;
  return { beam, dps, fps, eff, sus, op: n("OPs") };
}
function derivedHtml() {
  const d = weaponDerived(W.row), f = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : (Math.round(v * 10 ** dp) / 10 ** dp).toString());
  return `<div class="derived">
    <div><b>${f(d.dps)}</b><span>DPS</span></div><div><b>${f(d.fps)}</b><span>flux/sec</span></div>
    <div><b>${f(d.eff, 2)}</b><span>flux per damage</span></div>${d.sus != null ? `<div><b>${f(d.sus)}</b><span>sustained DPS (ammo regen)</span></div>` : ""}
    <div><b>${d.op && d.dps ? f(d.dps / d.op) : "—"}</b><span>DPS per OP</span></div></div>
    <div class="muted" style="font-size:11px">Estimates from charge, cooldown and burst timings; skills and hullmods not included.</div>`;
}

function renderWeaponEditor() {
  if (!W) return;
  const r = W.row, sprites = { TURRET: W.wpn.turretSprite, HARDPOINT: W.wpn.hardpointSprite || W.wpn.turretSprite };
  const dirty = weaponDirty();
  $("#weapon-detail").innerHTML = `
    <div class="ed-head">
      <div><h2>${esc(r.name || W.id)}${W.isNew ? ' <span class="badge live">new</span>' : ""}</h2>
        <div class="muted">${esc(W.id)} · ${esc(W.wpn.size || "")} ${esc(W.wpn.type || "")} · CSV from ${esc(r._source)} · .wpn from ${esc(W.wpnSource || "—")}</div></div>
      <div class="btnrow" style="margin:0">
        <button data-tool="files-weapon" title="Open this weapon's files (.wpn, stats, projectile, sprites) or show them in their folder">📂 Files</button>
        <button data-tool="usage-weapon" title="Find variants, hulls, wings and factions that use this weapon">Where used</button>
        <button data-tool="fac-weapon" title="Let factions know (use, sell) this weapon, and set blueprint tags">Factions…</button>
        <button id="w-dup">Duplicate as new weapon…</button>
        <button id="w-revert" ${dirty ? "" : "disabled"} title="Throw away this weapon's pending changes">Revert</button>
      </div>
    </div>
    <div id="w-pending">${pendingLine(W.uid)}</div>
    ${weaponSimHtml()}
    <div class="ed-cols">
      <div class="ed-col">
        <h3>Sprite & fire points</h3>
        <div class="btnrow" style="margin-top:0">
          <button class="mode${W.mount === "TURRET" ? " active" : ""}" data-mount="TURRET">Turret</button>
          <button class="mode${W.mount === "HARDPOINT" ? " active" : ""}" data-mount="HARDPOINT">Hardpoint</button>
          <label class="muted"><input type="checkbox" id="fp-mirror"> Mirror</label>
        </div>
        <canvas id="fp-canvas" width="420" height="380"></canvas>
        <div class="muted" style="font-size:11px">Click a fire point to select · drag to move · Alt+drag to aim · Shift+click to add · Del to remove.
          The cross is the mount point (turret: sprite center; hardpoint: 75% down).</div>
        <div id="fp-info" class="muted" style="font-size:12px;margin-top:4px"></div>
        <h3>Weapon file (.wpn)</h3>
        <div class="form">${WPN_FIELDS.map(([k, opts]) => {
          const v = Array.isArray(W.wpn[k]) ? W.wpn[k].join(", ") : W.wpn[k] ?? "";
          return opts ? `<label>${esc(k)}</label><select data-wpn="${k}">${(opts.includes(v) ? opts : [v].concat(opts)).map((o) => `<option${o === v ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
                      : k.endsWith("Sprite") ? `<label>${esc(k)}</label>${imgFieldHtml(`<input data-wpn="${k}" value="${esc(v)}">`, v, "graphics/weapons")}`
                      : `<label>${esc(k)}</label><input data-wpn="${k}" value="${esc(v)}">`;
        }).join("")}</div>
        <details style="margin-top:8px"><summary class="muted">Raw .wpn JSON (everything else)</summary>
          <textarea id="wpn-raw" rows="14" style="width:100%;font-family:monospace;font-size:12px">${esc(JSON.stringify(W.wpn, null, 2))}</textarea>
          <div class="btnrow"><button id="wpn-raw-apply">Apply JSON</button></div></details>
        <div id="w-extra">${weaponExtraHtml()}</div>
        ${W.proj ? `<details style="margin-top:8px"><summary class="muted">Raw .proj JSON (everything else)</summary>
          <textarea id="proj-raw" rows="12" style="width:100%;font-family:monospace;font-size:12px">${esc(JSON.stringify(W.proj, null, 2))}</textarea>
          <div class="btnrow"><button id="proj-apply">Apply JSON</button></div></details>` : ""}
      </div>
      <div class="ed-col">
        <h3>Performance</h3><div id="w-derived">${derivedHtml()}</div>
        ${csvGroups(r, WEAPON_GROUPS, { readonly: W.isNew ? [] : ["id"] })}
        <h3>Description</h3>
        <textarea id="w-desc" rows="6" style="width:100%">${esc(W.desc ? W.desc.text1 : "")}</textarea>
        <div class="muted" style="font-size:11px;word-break:break-all;margin-top:8px">${esc(r._file || "")}<br>${esc(W.wpnPath || "")}</div>
      </div>
    </div>`;
  bindCsv($("#weapon-detail"), r, (col) => { if (col === "id") { W.id = r.id; W.wpn.id = r.id; } $("#w-derived").innerHTML = derivedHtml(); });
  $("#weapon-detail").querySelectorAll("[data-wpn]").forEach((i) => (i.onchange = () => {
    const k = i.dataset.wpn;
    W.wpn[k] = k === "renderHints" ? i.value.split(",").map((x) => x.trim()).filter(Boolean) : i.value;
    if (k.endsWith("Sprite")) W.imgs = {};
    if (k === "projectileSpecId") { loadWeaponProj(W, i.value); return; }
    renderWeaponEditor(); scheduleSync();
  }));
  $("#weapon-detail").querySelectorAll("[data-mount]").forEach((b) => (b.onclick = () => { W.mount = b.dataset.mount; W.sel = -1; W.view = null; renderWeaponEditor(); }));
  $("#wpn-raw-apply").onclick = () => { try { W.wpn = JSON.parse($("#wpn-raw").value); W.imgs = {}; renderWeaponEditor(); scheduleSync(); } catch (e) { toast("Invalid JSON: " + e.message, true); } };
  if ($("#proj-apply")) $("#proj-apply").onclick = () => { try { W.proj = JSON.parse($("#proj-raw").value); renderWeaponEditor(); scheduleSync(); } catch (e) { toast("Invalid JSON: " + e.message, true); } };
  $("#w-desc").oninput = () => { W.desc = W.desc || { id: W.id, type: "WEAPON", text1: "", _source: null }; W.desc.text1 = $("#w-desc").value; scheduleSync(); };
  $("#w-dup").onclick = duplicateWeapon;
  $("#w-revert").onclick = () => revertDoc(W, S.weaponDocs, () => { const id = W.isNew ? null : W.id; W = null; if (id) showWeapon(id); else $("#weapon-detail").innerHTML = '<p class="muted">Select a weapon.</p>'; });
  bindReview($("#weapon-detail"));
  setupFirePoints(sprites[W.mount]);
  bindWeaponExtra();
  attachWeaponSim();
}
function markWeaponDirty() {
  if (!W) return;
  const p = $("#w-pending"); if (p) { p.innerHTML = pendingLine(W.uid); bindReview(p); }
  const rv = $("#w-revert"); if (rv) rv.disabled = !weaponDirty();
}
function bindReview(root) { root.querySelectorAll(".review-btn").forEach((b) => (b.onclick = openChanges)); }
/** Drops a document's pending entries and reloads it from disk. */
function revertDoc(doc, registry, reopen) {
  if (!confirm("Throw away all pending changes to this item?")) return;
  for (const [k, e] of [...CH.entries]) if (e.ownerKey === doc.uid) drop(k);
  for (const [id, d] of Object.entries(registry)) if (d === doc) delete registry[id];
  renderChangesBadge(); reopen(); renderWeaponListMarks();
}

// ---------------------------------------------------------------- fire point canvas
const FP = { drag: null };
function fpKeys() { return W.mount === "HARDPOINT" ? ["hardpointOffsets", "hardpointAngleOffsets"] : ["turretOffsets", "turretAngleOffsets"]; }
function fpPoints() {
  const [ok, ak] = fpKeys(), o = W.wpn[ok] || [], a = W.wpn[ak] || [], pts = [];
  for (let i = 0; i + 1 < o.length; i += 2) pts.push({ x: o[i], y: o[i + 1], a: a[i / 2] ?? 0 });
  return pts;
}
function fpWrite(pts) {
  const [ok, ak] = fpKeys();
  W.wpn[ok] = pts.flatMap((p) => [p.x, p.y]);
  W.wpn[ak] = pts.map((p) => p.a);
  scheduleSync();
}
function setupFirePoints(spritePath) {
  const cnv = $("#fp-canvas"), g = cnv.getContext("2d");
  const key = W.mount + "|" + spritePath;
  const draw = () => {
    const img = W.imgs[key];
    g.fillStyle = THEME.background; g.fillRect(0, 0, cnv.width, cnv.height);
    if (!img || img === "loading") { g.fillStyle = "#7c8da3"; g.fillText(spritePath ? "Loading sprite…" : "No sprite set for this mount.", 12, 20); return; }
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!W.view) { const s = Math.max(1, Math.floor(Math.min((cnv.width - 40) / iw, (cnv.height - 40) / ih))); W.view = { s, ox: (cnv.width - iw * s) / 2, oy: (cnv.height - ih * s) / 2 }; }
    const { s, ox, oy } = W.view;
    // checker
    for (let y = 0; y < ih * s; y += 8) for (let x = 0; x < iw * s; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? THEME.checkerB : THEME.checkerA; g.fillRect(ox + x, oy + y, Math.min(8, iw * s - x), Math.min(8, ih * s - y)); }
    g.imageSmoothingEnabled = false; g.drawImage(img, ox, oy, iw * s, ih * s);
    const [ax, ay] = fpAnchor(img);
    const toS = (p) => [ox + (ax - p.y) * s, oy + (ay - p.x) * s];
    // mount point
    const [mx, my] = toS({ x: 0, y: 0 });
    g.strokeStyle = THEME.center; g.lineWidth = 2; g.beginPath(); g.moveTo(mx - 8, my); g.lineTo(mx + 8, my); g.moveTo(mx, my - 8); g.lineTo(mx, my + 8); g.stroke();
    if ($("#fp-mirror") && $("#fp-mirror").checked) { g.setLineDash([4, 4]); g.strokeStyle = hexA(THEME.mirror, 0.3); g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, cnv.height); g.stroke(); g.setLineDash([]); }
    fpPoints().forEach((p, i) => {
      const [x, y] = toS(p), a = (p.a * Math.PI) / 180, sel = i === W.sel;
      g.strokeStyle = sel ? THEME.select : "#ffd166"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.sin(a) * 26, y - Math.cos(a) * 26); g.stroke();
      g.fillStyle = sel ? THEME.select : "#ffd166"; g.beginPath(); g.arc(x, y, sel ? 5 : 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.font = "11px sans-serif"; g.fillText(String(i + 1), x + 6, y - 6);
    });
    const p = fpPoints()[W.sel];
    $("#fp-info").textContent = `${fpPoints().length} fire point(s)` + (p ? ` · #${W.sel + 1}: forward ${p.x}, left ${p.y}, angle ${p.a}°` : "");
  };
  W.drawFP = draw;
  if (spritePath && !W.imgs[key]) {
    W.imgs[key] = "loading";
    const img = new Image(); img.onload = () => { W.imgs[key] = img; W.view = null; draw(); }; img.src = asset(spritePath);
  }
  const toP = (e) => {
    const img = W.imgs[key]; if (!img || img === "loading") return null;
    const r = cnv.getBoundingClientRect(), sx = (e.clientX - r.left) * (cnv.width / r.width), sy = (e.clientY - r.top) * (cnv.height / r.height);
    const [ax, ay] = fpAnchor(img), { s, ox, oy } = W.view;
    const sn = (v) => Math.round(v * 2) / 2;
    return { x: sn(ay - (sy - oy) / s), y: sn(ax - (sx - ox) / s), sx, sy };
  };
  const hit = (q) => {
    const img = W.imgs[key], [ax, ay] = fpAnchor(img), { s, ox, oy } = W.view;
    let best = -1, bd = 10;
    fpPoints().forEach((p, i) => { const d = Math.hypot(ox + (ax - p.y) * s - q.sx, oy + (ay - p.x) * s - q.sy); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const twinOf = (pts, i) => pts.findIndex((q, j) => j !== i && Math.abs(q.x - pts[i].x) < 0.01 && Math.abs(q.y + pts[i].y) < 0.01 && Math.abs(pts[i].y) > 0.01);
  cnv.onmousedown = (e) => {
    const q = toP(e); if (!q) return;
    const i = hit(q), pts = fpPoints();
    if (i >= 0) { W.sel = i; FP.drag = { i, aim: e.altKey, twin: $("#fp-mirror").checked ? twinOf(pts, i) : -1 }; draw(); return; }
    if (e.shiftKey) {
      pts.push({ x: q.x, y: q.y, a: 0 });
      if ($("#fp-mirror").checked && Math.abs(q.y) > 0.01) pts.push({ x: q.x, y: -q.y, a: 0 });
      fpWrite(pts); W.sel = pts.length - 1; draw(); markWeaponDirty(); return;
    }
    W.sel = -1; draw();
  };
  cnv.onmousemove = (e) => {
    if (!FP.drag) return;
    const q = toP(e); if (!q) return;
    const pts = fpPoints(), p = pts[FP.drag.i], t = FP.drag.twin >= 0 ? pts[FP.drag.twin] : null;
    if (FP.drag.aim) { p.a = Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI * 2) / 2; if (t) t.a = -p.a; }
    else { p.x = q.x; p.y = q.y; if (t) { t.x = q.x; t.y = -q.y; } }
    fpWrite(pts); draw();
  };
  cnv.onmouseup = () => { if (FP.drag) { FP.drag = null; renderWeaponEditor(); } };
  cnv.tabIndex = 0;
  cnv.onkeydown = (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && W.sel >= 0) {
      const pts = fpPoints(), t = $("#fp-mirror").checked ? twinOf(pts, W.sel) : -1;
      for (const i of [W.sel, t].filter((x) => x >= 0).sort((a, b) => b - a)) pts.splice(i, 1);
      fpWrite(pts); W.sel = -1; renderWeaponEditor(); e.preventDefault();
    }
  };
  draw();
}
function fpAnchor(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  return W.mount === "HARDPOINT" ? [w / 2, h * 0.75] : [w / 2, h / 2];
}

// ---------------------------------------------------------------- save / duplicate
function duplicateWeapon() {
  const id = prompt("Id for the new weapon:", W.id + "_mk2");
  if (!id) return;
  if (S.weapons[id]) { toast(`A weapon with id "${id}" already exists.`, true); return; }
  if (!$("#save-target").value) { toast("Choose a mod in “Save to mod” first: the new weapon is created there.", true); return; }
  const row = clone(W.row); row.id = id; row.name = (row.name || id) + " (copy)"; row._file = null; row._source = null;
  W = Object.assign({}, W, {
    id, row, rowOrig: "", wpn: Object.assign(clone(W.wpn), { id }), wpnOrig: "", wpnPath: null, wpnSource: null,
    desc: W.desc ? Object.assign(clone(W.desc), { id, _file: null, _source: null }) : null, descOrig: "",
    proj: null, projOrig: "null", isNew: true, imgs: {}, sel: -1, view: null, uid: newUid("weapon"),
  });
  S.weaponDocs[id] = W;
  renderWeaponEditor(); scheduleSync();
  toast("Created a copy. Its files are in the Changes list, ready to be written into " + sourceById($("#save-target").value).name + ".");
}

// ================================================================ WING (FIGHTER) EDITOR
const WING_GROUPS = [
  ["Wing", [["id"], ["variant", "fighter variant"], ["role", null, "select", ["FIGHTER", "BOMBER", "INTERCEPTOR", "ASSAULT", "SUPPORT"]], ["role desc"],
    ["num", "fighters per wing"], ["formation", null, "select", ["V", "CLAW", "BOX"]], ["op cost", "OP cost"], ["refit", "refit time (s)"], ["range", "engagement range"],
    ["attackRunRange"], ["attackPositionOffset"]]],
  ["Economy", [["fleet pts"], ["tier"], ["rarity"], ["base value"], ["tags"]]],
];
const FIGHTER_HULL_GROUPS = [
  ["Fighter hull (ship_data.csv)", [["name"], ["designation"], ["hitpoints"], ["armor rating"], ["max flux"], ["flux dissipation"], ["max speed"], ["acceleration"], ["deceleration"],
    ["max turn rate"], ["turn acceleration"], ["mass"], ["shield type"], ["defense id"], ["shield arc"], ["shield upkeep"], ["shield efficiency"], ["system id"]]],
];
let WG = null;
function wingDirty() { return !!WG && (JSON.stringify(stripPriv(WG.row)) !== WG.rowOrig || (WG.hull && JSON.stringify(stripPriv(WG.hull)) !== WG.hullOrig) || WG.isNew); }

async function showWing(id) {
  if (S.wingDocs[id]) { WG = S.wingDocs[id]; markListSelection("#wing-list", id); renderWingEditor(); return; }
  const w = S.wingById[id];
  if (!w) return;
  if (!S.allVariants) S.allVariants = Object.fromEntries((await api("/api/variants")).map((v) => [v.variantId, v]));
  const fv = S.allVariants[w.variant], fhId = fv && fv.hullId;
  const fh = fhId ? await api("/api/hull?id=" + encodeURIComponent(fhId)).catch(() => null) : null;
  const hullRow = fh && fh.csv ? clone(fh.csv) : null;
  WG = { id, row: clone(w), fhId, fh, hull: hullRow, isNew: false, fv, uid: newUid("wing") };
  WG.rowOrig = JSON.stringify(stripPriv(WG.row)); WG.hullOrig = hullRow ? JSON.stringify(stripPriv(hullRow)) : null;
  S.wingDocs[id] = WG;
  markListSelection("#wing-list", id);
  renderWingEditor();
}
async function fighterLoadout() {
  if (!WG.fv) return "";
  const v = await api("/api/file?path=" + encodeURIComponent(WG.fv.path)).catch(() => null);
  if (!v) return "";
  const ws = {};
  for (const g of v.weaponGroups || []) Object.assign(ws, g.weapons || {});
  const bi = (WG.fh && (WG.fh.ship || WG.fh.baseShip) || {}).builtInWeapons || {};
  Object.assign(ws, bi);
  const items = Object.entries(ws).map(([slot, wid]) => { const wd = S.weapons[wid] || {}; return `<div class="chip"><img src="${asset(wd._turretSprite || wd._hardpointSprite)}" alt=""><span class="grow">${esc(slot)} · ${esc(wd.name || wid)}</span>${bi[slot] ? '<span class="badge restart">built-in</span>' : ""}</div>`; });
  const mods = (v.hullMods || []).map((m) => (S.hullmodById[m] || {}).name || m);
  return `<div class="chips">${items.join("") || '<span class="muted">No weapons</span>'}</div>${mods.length ? `<div class="muted" style="margin-top:4px">Hullmods: ${esc(mods.join(", "))}</div>` : ""}`;
}
async function renderWingEditor() {
  if (!WG) return;
  const r = WG.row, ship = WG.fh && (WG.fh.ship || WG.fh.baseShip), sprite = WG.fh && ((WG.fh.skin && WG.fh.skin.spriteName) || (ship && ship.spriteName));
  const dirty = wingDirty();
  $("#wing-detail").innerHTML = `
    <div class="ed-head">
      <div><h2>${esc(r.id)}${WG.isNew ? ' <span class="badge live">new</span>' : ""}</h2>
        <div class="muted">${esc(r.role || "")} · wing from ${esc(r._source)}${WG.fhId ? " · fighter hull " + esc(WG.fhId) + (WG.hull ? " from " + esc(WG.hull._source) : "") : ""}</div></div>
      <div class="btnrow" style="margin:0">
        <button data-tool="files-wing" title="Open this wing's files (stats, fighter hull, variant, sprite) or show them in their folder">📂 Files</button>
        <button data-tool="usage-wing" title="Find variants, hulls and factions that use this wing">Where used</button>
        <button data-tool="fac-wing" title="Let factions know (use, sell) this wing, and set blueprint tags">Factions…</button>
        <button id="wg-dup">Duplicate as new wing…</button>
        <button id="wg-revert" ${dirty ? "" : "disabled"} title="Throw away this wing's pending changes">Revert</button>
      </div>
    </div>
    <div id="wg-pending">${pendingLine(WG.uid)}</div>
    <div class="ed-cols">
      <div class="ed-col">
        ${sprite ? `<div class="sprite-box"><img src="${asset(sprite)}"><div class="muted">${esc(r.num || "?")} × ${esc(ship && ship.hullName || WG.fhId)}</div></div>` : '<p class="muted">Fighter hull not found for this variant.</p>'}
        <h3>Loadout <span class="muted">(${esc(r.variant)})</span></h3><div id="wg-loadout" class="muted">…</div>
        <div class="btnrow">${WG.fhId ? `<button id="wg-open">Edit fighter geometry & loadout in Ships tab</button>` : ""}</div>
        <p class="muted" style="font-size:12px">The Ships tab opens the fighter hull with this wing's variant selected, so you can move slots, engines and bounds and change its weapons, then save as usual.</p>
        ${WG.hull ? csvGroups(WG.hull, FIGHTER_HULL_GROUPS) : ""}
      </div>
      <div class="ed-col">${csvGroups(r, WING_GROUPS, { readonly: WG.isNew ? [] : ["id"], showMissing: true })}</div>
    </div>`;
  const cols = $("#wing-detail").querySelectorAll(".ed-col");
  bindCsv(cols[1], r);
  if (WG.hull) bindCsv(cols[0], WG.hull);
  $("#wg-dup").onclick = duplicateWing;
  $("#wg-revert").onclick = () => revertDoc(WG, S.wingDocs, () => { const id = WG.isNew ? null : WG.id; WG = null; if (id) showWing(id); else $("#wing-detail").innerHTML = '<p class="muted">Select a wing.</p>'; });
  bindReview($("#wing-detail"));
  if ($("#wg-open")) $("#wg-open").onclick = () => { $('#tabs button[data-tab="ships"]').click(); selectHull(WG.fhId, r.variant); };
  const lo = await fighterLoadout(); if ($("#wg-loadout")) $("#wg-loadout").outerHTML = `<div id="wg-loadout">${lo || '<span class="muted">Variant file not found.</span>'}</div>`;
}
function markWingDirty() {
  if (!WG) return;
  const p = $("#wg-pending"); if (p) { p.innerHTML = pendingLine(WG.uid); bindReview(p); }
  const rv = $("#wg-revert"); if (rv) rv.disabled = !wingDirty();
}
function duplicateWing() {
  const id = prompt("Id for the new wing:", WG.id.replace(/_wing$/, "") + "_mk2_wing");
  if (!id) return;
  if (S.wingById[id]) { toast(`A wing with id "${id}" already exists.`, true); return; }
  if (!$("#save-target").value) { toast("Choose a mod in “Save to mod” first: the new wing is created there.", true); return; }
  WG = Object.assign({}, WG, { id, row: Object.assign(clone(WG.row), { id, _file: null, _source: null }), rowOrig: "", isNew: true, uid: newUid("wing"),
    hull: WG.hull ? clone(WG.hull) : null });
  S.wingDocs[id] = WG;
  renderWingEditor(); scheduleSync();
  toast("Created a copy (in the Changes list). It uses the same fighter variant; change “fighter variant” to point at another one.");
}

// ================================================================ SHIP STATS (ship_data.csv) in View mode
const SHIP_STAT_GROUPS = [
  ["Identity", [["name"], ["designation"], ["tech/manufacturer"], ["system id"], ["defense id"], ["hints"], ["tags"], ["travel drive"]]],
  ["Combat", [["hitpoints"], ["armor rating"], ["max flux"], ["flux dissipation"], ["ordnance points"], ["fighter bays"],
    ["shield type", null, "select", ["NONE", "FRONT", "OMNI", "PHASE"]], ["shield arc"], ["shield upkeep"], ["shield efficiency"], ["phase cost"], ["phase upkeep"]]],
  ["Mobility", [["max speed"], ["acceleration"], ["deceleration"], ["max turn rate"], ["turn acceleration"], ["mass"]]],
  ["Logistics", [["fleet pts"], ["min crew"], ["max crew"], ["cargo"], ["fuel"], ["fuel/ly"], ["range"], ["max burn"], ["base value"],
    ["cr %/day"], ["CR to deploy"], ["peak CR sec"], ["CR loss/sec"], ["supplies/rec"], ["supplies/mo"], ["rarity"], ["breakProb"], ["minPieces"], ["maxPieces"]]],
];

// styles for the editors
document.head.insertAdjacentHTML("beforeend", `<style>
.ed-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.ed-cols { display: flex; gap: 24px; flex-wrap: wrap; }
.ed-col { flex: 1; min-width: 380px; }
#fp-canvas { width: 100%; max-width: 420px; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; cursor: crosshair; display: block; }
.derived { display: flex; gap: 8px; flex-wrap: wrap; }
.derived div { background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; display: flex; flex-direction: column; min-width: 90px; }
.derived b { font-size: 16px; } .derived span { font-size: 11px; color: var(--muted); }
table.kv textarea, .ed-col textarea { width: 100%; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 4px; font: inherit; }
table.kv select { width: 100%; }
.list .item.selected { background: #1d3550; }
</style>`);
