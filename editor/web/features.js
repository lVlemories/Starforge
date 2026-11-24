// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Station modules, weapon groups, validation checks and the "new hull / duplicate / new skin / new mod" dialogs.
// Loaded after app.js and editors.js.

// ================================================================ shared lookups
let allVariantsPromise = null;
function ensureAllVariants() {
  if (S.allVariants) return Promise.resolve(S.allVariants);
  if (!allVariantsPromise) allVariantsPromise = api("/api/variants").then((l) => (S.allVariants = Object.fromEntries(l.map((v) => [v.variantId, v]))));
  return allVariantsPromise;
}
S.systemIds = null;
api("/api/systems").then((l) => { S.systemIds = new Set(l.map((x) => x.id)); if (S.cur) renderDetail(); }).catch(() => {});

// ================================================================ STATION MODULES
/** variant.modules is a list of {slotId: variantId}; returns a flat map. */
function variantModules(v) {
  const out = {};
  for (const m of (v && v.modules) || []) Object.assign(out, m);
  return out;
}
function setModule(slotId, variantId) {
  const v = S.cur.variant, map = variantModules(v);
  if (variantId) map[slotId] = variantId; else delete map[slotId];
  v.modules = Object.entries(map).map(([k, x]) => ({ [k]: x }));
}
S.modCache = {};
/**
 * Module variant -> {entry, hull (resolved .ship JSON, skins applied), variant (JSON), hints, sprite, img}.
 * Loads lazily and redraws when ready. If the hull is open in a tab, its live (unsaved) data is used instead.
 */
function moduleInfo(variantId) {
  const hit = S.modCache[variantId];
  if (hit) return hit.ready ? withLive(hit) : null;
  S.modCache[variantId] = { ready: false };
  (async () => {
    await ensureAllVariants();
    const ve = S.allVariants[variantId];
    if (!ve) { S.modCache[variantId] = { ready: true, missing: true }; return; }
    const [data, vjson] = await Promise.all([api("/api/hull?id=" + encodeURIComponent(ve.hullId)).catch(() => null), api("/api/file?path=" + encodeURIComponent(ve.path)).catch(() => null)]);
    const hull = data && (data.skin ? applySkin(data.baseShip, data.skin) : data.ship);
    if (!hull) { S.modCache[variantId] = { ready: true, missing: true, entry: ve }; return; }
    const info = { ready: true, entry: ve, hullId: ve.hullId, hull: Object.assign({}, hull, data.skin ? { hullName: data.skin.hullName } : {}),
      variant: vjson ? normalizeVariant(vjson) : null,
      hints: String((S.hullById[ve.hullId] || {}).hints || ""), sprite: (data.skin && data.skin.spriteName) || hull.spriteName, img: null };
    S.modCache[variantId] = info;
    info.img = partImg(info.sprite);
    if (S.cur) renderDetail();
    draw();
  })();
  return null;
}
/** Prefer a hull's open tab (live edits) over the copy loaded from disk. */
function withLive(info) {
  const doc = info.hullId && S.shipDocs[info.hullId];
  if (!doc || doc === S.cur) return info;
  const v = doc.variant && info.variant && doc.variant.variantId === info.variant.variantId ? doc.variant : info.variant;
  return Object.assign({}, info, { hull: doc.ship, variant: v, img: doc.img || info.img });
}
const PART_IMGS = {};
/** Shared image cache for attached parts and their weapons (redraws once loaded). */
function partImg(path) {
  if (!path) return null;
  let im = PART_IMGS[path];
  if (!im) { im = PART_IMGS[path] = new Image(); im.onload = () => draw(); im.src = asset(path); }
  return im.complete && im.naturalWidth ? im : null;
}

// ---------------------------------------------------------------- attached parts (modules <-> parent)
/** Attached parts display: "visible", "faded" (transparent) or "hidden". Remembered. */
function attachMode() { const el = $("#attach-mode"); return el ? el.value : "visible"; }
const rotFL = (a, f, l) => { const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [f * c - l * s, f * s + l * c]; };
/** Frame placing a module (anchor A) on a slot: module-local [f,l] -> parent-local [f,l]. */
function slotFrame(slot, A) {
  const L = loc(slot), a = slot.angle || 0;
  return (f, l) => { const [x, y] = rotFL(a, f - A[0], l - A[1]); return [L[0] + x, L[1] + y]; };
}
/** The inverse: parent-local -> module-local, for showing the parent around a module. */
function slotFrameInv(slot, A) {
  const L = loc(slot), a = slot.angle || 0;
  return (f, l) => { const [x, y] = rotFL(-a, f - L[0], l - L[1]); return [A[0] + x, A[1] + y]; };
}
/** Draws img so its pixel (ix,iy) lands at local origin + xV*ix + yV*iy, through frame (local -> current ship) and toScreen. */
function drawQuad(img, frame, origin, xV, yV, w, h) {
  const S0 = toScreen(...frame(origin[0], origin[1]));
  const S1 = toScreen(...frame(origin[0] + xV[0], origin[1] + xV[1])), S2 = toScreen(...frame(origin[0] + yV[0], origin[1] + yV[1]));
  ctx.save(); ctx.transform(S1[0] - S0[0], S1[1] - S0[1], S2[0] - S0[0], S2[1] - S0[1], S0[0], S0[1]);
  ctx.drawImage(img, 0, 0, w ?? img.naturalWidth, h ?? img.naturalHeight); ctx.restore();
  return [S0, S1, S2];
}
/** Sprite pixels -> ship-local coords for an image centred on (f0,l0), facing angle a, with anchor pixel (ax,ay). */
function spriteAxes(f0, l0, a, ax, ay) {
  const u = rotFL(a, 1, 0), v = rotFL(a, 0, 1); // forward and left unit vectors
  return { origin: [f0 + u[0] * ay + v[0] * ax, l0 + u[1] * ay + v[1] * ax], xV: [-v[0], -v[1]], yV: [-u[0], -u[1]] };
}
/** Draws a whole ship part (hull sprite, engine flames, fitted weapons) through a frame. Returns its sprite quad for clicks. */
function drawPart(part, frame, alpha) {
  const h = part.hull, img = part.img || partImg(part.sprite); if (!h || !img) return null;
  ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = V.scale < 2;
  const cm = h.center || [img.naturalWidth / 2, img.naturalHeight / 2];
  // engine flames (under the hull, as in game)
  for (const e of h.engineSlots || []) {
    const col = engineColor(e), fl = tintedFlame(col), len = e.length || 0, wid = e.width || 0;
    if (!fl || len <= 0 || wid <= 0 || (col[3] ?? 255) <= 0) continue;
    const L = loc(e), d = rotFL(e.angle ?? 180, 1, 0), pp = rotFL(e.angle ?? 180, 0, 1);
    const o = [L[0] - pp[0] * wid / 2, L[1] - pp[1] * wid / 2], xV = [d[0] * len / fl.width, d[1] * len / fl.width], yV = [pp[0] * wid / fl.height, pp[1] * wid / fl.height];
    ctx.imageSmoothingEnabled = true;
    drawQuad(fl, frame, o, xV, yV);
    if (FLAME_CORE.complete) drawQuad(FLAME_CORE, frame, o, [d[0] * len / FLAME_CORE.naturalWidth, d[1] * len / FLAME_CORE.naturalWidth], [pp[0] * wid / FLAME_CORE.naturalHeight, pp[1] * wid / FLAME_CORE.naturalHeight]);
    ctx.imageSmoothingEnabled = V.scale < 2;
  }
  const ax = spriteAxes(0, 0, 0, cm[0], img.naturalHeight - cm[1]);
  const quad = drawQuad(img, frame, ax.origin, ax.xV, ax.yV);
  // fitted weapons (variant + built-ins)
  const fitted = Object.assign({}, h.builtInWeapons || {});
  for (const g of (part.variant && part.variant.weaponGroups) || []) Object.assign(fitted, g.weapons || {});
  for (const s of h.weaponSlots || []) {
    const w = fitted[s.id], wd = w && S.weapons[w];
    if (!wd || s.mount === "HIDDEN" || s.type === "LAUNCH_BAY" || s.type === "STATION_MODULE") continue;
    const wi = partImg(s.mount === "HARDPOINT" ? wd._hardpointSprite || wd._turretSprite : wd._turretSprite); if (!wi) continue;
    const L = loc(s), wa = spriteAxes(L[0], L[1], s.angle || 0, wi.naturalWidth / 2, wi.naturalHeight * (s.mount === "HARDPOINT" ? 0.75 : 0.5));
    drawQuad(wi, frame, wa.origin, wa.xV, wa.yV);
  }
  ctx.restore();
  return { quad, img };
}
/** Parts to draw around the current ship: its modules, or (for a module) its parent ship and sibling modules. */
function attachedParts(c) {
  const out = [];
  if (!c) return out;
  for (const [slotId, vid] of Object.entries(variantModules(c.variant))) {
    const slot = c.ship.weaponSlots.find((s) => s.id === slotId), info = moduleInfo(vid);
    if (!slot || !info || info.missing) continue;
    out.push({ kind: "module", info, vid, slotId, under: /UNDER_PARENT/.test(info.hints), frame: slotFrame(slot, info.hull.moduleAnchor || [0, 0]) });
  }
  const pr = c.parentRef;
  if (pr && pr.info && pr.info.hull && Array.isArray(c.ship.moduleAnchor || [0, 0])) {
    const slot = (pr.info.hull.weaponSlots || []).find((s) => s.id === pr.slot);
    if (slot) {
      const toMe = slotFrameInv(slot, c.ship.moduleAnchor || [0, 0]);
      out.push({ kind: "parent", info: pr.info, vid: pr.parentVariant, under: true, frame: toMe });
      for (const [sid, vid] of Object.entries(variantModules(pr.info.variant))) {
        if (sid === pr.slot) continue;
        const s2 = pr.info.hull.weaponSlots.find((s) => s.id === sid), mi = moduleInfo(vid);
        if (!s2 || !mi || mi.missing) continue;
        const toParent = slotFrame(s2, mi.hull.moduleAnchor || [0, 0]);
        out.push({ kind: "sibling", info: mi, vid, slotId: sid, under: true, frame: (f, l) => toMe(...toParent(f, l)) });
      }
    }
  }
  return out;
}
/** Called from draw(): underPass draws parts below the current hull. */
function drawModules(underPass) {
  const c = S.cur, mode = attachMode(); if (!c || mode === "hidden") return;
  if (underPass) c._partHits = [];
  const alpha = mode === "faded" ? 0.35 : 1;
  const parts = attachedParts(c).filter((p) => p.under === underPass);
  // parent first, then siblings, then the current ship's modules
  parts.sort((a, b) => ({ parent: 0, sibling: 1, module: 2 }[a.kind] - { parent: 0, sibling: 1, module: 2 }[b.kind]));
  for (const p of parts) { const r = drawPart(p.info, p.frame, alpha); if (r) c._partHits.push(Object.assign({ part: p }, r)); }
}
/** Bounding box of the shown attached parts, in the current sprite's pixel coordinates (for fitting the view). */
function attachedBox() {
  const c = S.cur; if (!c || attachMode() === "hidden") return null;
  const cc = c.ship.center || [0, 0], { H } = dims();
  let box = null;
  for (const p of attachedParts(c)) {
    const img = p.info.img || partImg(p.info.sprite), h = p.info.hull; if (!img || !h) continue;
    const cm = h.center || [img.naturalWidth / 2, img.naturalHeight / 2], ax = spriteAxes(0, 0, 0, cm[0], img.naturalHeight - cm[1]);
    for (const [ix, iy] of [[0, 0], [img.naturalWidth, 0], [0, img.naturalHeight], [img.naturalWidth, img.naturalHeight]]) {
      const [f, l] = p.frame(ax.origin[0] + ax.xV[0] * ix + ax.yV[0] * iy, ax.origin[1] + ax.xV[1] * ix + ax.yV[1] * iy);
      const px = cc[0] - l, py = H - cc[1] - f;
      box = box ? [Math.min(box[0], px), Math.min(box[1], py), Math.max(box[2], px), Math.max(box[3], py)] : [px, py, px, py];
    }
  }
  return box;
}
/** Which attached part (if any) is under a screen point; uses the sprite's own transparency. */
const HIT_CANVAS = document.createElement("canvas"), HIT_DATA = new Map();
function partAt(sx, sy) {
  const c = S.cur; if (!c || !c._partHits || attachMode() === "hidden") return null;
  for (let k = c._partHits.length - 1; k >= 0; k--) {
    const h = c._partHits[k], [S0, S1, S2] = h.quad;
    const a = S1[0] - S0[0], b = S1[1] - S0[1], cc = S2[0] - S0[0], d = S2[1] - S0[1], det = a * d - b * cc; if (!det) continue;
    const dx = sx - S0[0], dy = sy - S0[1], ix = (d * dx - cc * dy) / det, iy = (-b * dx + a * dy) / det;
    const W = h.img.naturalWidth, H = h.img.naturalHeight;
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
    let data = HIT_DATA.get(h.img);
    if (!data) { HIT_CANVAS.width = W; HIT_CANVAS.height = H; const g = HIT_CANVAS.getContext("2d"); g.clearRect(0, 0, W, H); g.drawImage(h.img, 0, 0); try { data = g.getImageData(0, 0, W, H).data; } catch (e) { data = null; } HIT_DATA.set(h.img, data); }
    if (data && data[(Math.floor(iy) * W + Math.floor(ix)) * 4 + 3] < 24) continue;
    return h.part;
  }
  return null;
}
const partLabel = (p) => `${p.kind === "parent" ? "Parent ship" : p.kind === "sibling" ? "Other module" : "Module"} ${p.info.hull.hullName || p.info.hullId} (${p.vid})`;
function openPart(p) {
  const hullId = p.info.hullId || (p.info.entry && p.info.entry.hullId);
  if (hullId) selectHull(hullId, p.vid);
}
/** For a module hull: find the ships that mount it (and load the chosen one). */
async function loadParentRef(c) {
  if (!c || c._parentsLoaded) return;
  c._parentsLoaded = true;
  const isModule = /\bMODULE\b/.test(String((S.hullById[c.id] || {}).hints || "") + " " + String(c.csv && c.csv.hints || "")) || Array.isArray(c.ship.moduleAnchor);
  if (!isModule) return;
  const list = await api("/api/moduleparents?hull=" + encodeURIComponent(c.id)).catch(() => []);
  c.parents = list;
  if (!list.length) { renderAttachParent(); return; }
  const mine = c.variant && list.find((x) => x.moduleVariant === c.variant.variantId);
  await setParentRef(c, mine || list[0]);
}
async function setParentRef(c, ref) {
  c.parentRef = Object.assign({}, ref, { info: null });
  renderAttachParent();
  const info = moduleInfo(ref.parentVariant); // same loader works for any variant
  const done = (i) => { if (i && !i.missing) c.parentRef.info = i; if (S.cur === c && attachMode() !== "hidden") setTimeout(fitView, 250); else draw(); };
  if (info) { done(info); return; }
  const wait = setInterval(() => { const i = moduleInfo(ref.parentVariant); if (i || !S.modCache[ref.parentVariant]) { clearInterval(wait); done(i); } }, 150);
}
function renderAttachParent() {
  const sel = $("#attach-parent"), c = S.cur;
  if (!sel) return;
  const list = (c && c.parents) || [];
  sel.classList.toggle("hidden", list.length < 2);
  sel.innerHTML = list.map((p, i) => `<option value="${i}"${c.parentRef && c.parentRef.parentVariant === p.parentVariant && c.parentRef.slot === p.slot ? " selected" : ""}>on ${esc(p.parentVariant)} · ${esc(p.slot)}</option>`).join("");
}
function moduleCard(slot) {
  const mv = variantModules(S.cur.variant)[slot.id], info = mv && moduleInfo(mv);
  const btns = `<div class="btnrow"><button data-act="moduleHere">${mv ? "Change module…" : "Choose module…"}</button>${mv ? '<button data-act="clearModuleHere">Remove</button>' : ""}</div>`;
  if (!mv) return `<div class="wcard empty"><span class="muted">No module fitted in the current variant.</span>${btns}</div>`;
  return `<div class="wcard"><div class="wtop">${info && info.sprite ? `<img src="${asset(info.sprite)}" alt="">` : ""}<div><b>${esc(mv)}</b>
    <div class="muted" style="font-size:11px">${info ? (info.missing ? "variant not found" : esc(info.hull.hullName || info.entry.hullId) + " · " + esc(info.entry.source)) : "loading…"}</div></div></div>${btns}</div>`;
}
async function openModulePicker(slot) {
  await ensureAllVariants();
  const current = variantModules(S.cur.variant)[slot.id];
  openPicker(`Module for ${slot.id}`, "Show all variants (not only MODULE hulls)", (q, all, src) => Object.values(S.allVariants)
    .filter((v) => { const h = S.hullById[v.hullId] || {}; return (all || /\bMODULE\b/.test(h.hints || "")) && (!src || v.source === src) && matches(q, v.variantId, v.hullId, h.hullName, v.displayName); })
    .sort((a, b) => a.variantId.localeCompare(b.variantId)).slice(0, 400)
    .map((v) => { const h = S.hullById[v.hullId] || {};
      return { value: v.variantId, html: `<img src="${asset(h.spriteName)}" alt=""><div><div><b>${esc(v.variantId)}</b>${v.variantId === current ? ' <span class="badge live">fitted</span>' : ""}</div>
        <div class="muted" style="font-size:11px">${esc(h.hullName || v.hullId)} · ${esc(v.displayName || "")} · ${esc(v.source)}</div></div>` }; }),
  (vid) => edit(() => setModule(slot.id, vid)), Object.values(S.allVariants).map((v) => v.source));
}

// ================================================================ WEAPON GROUPS
function weaponGroupsPanel(v) {
  const gs = v.weaponGroups || [];
  const opts = (i) => gs.map((_, k) => `<option value="${k}"${k === i ? " selected" : ""}>Group ${k + 1}</option>`).join("") + '<option value="new">New group</option>';
  return `<h3>Weapon groups <span class="muted">(${gs.length}/7)</span></h3>
    ${gs.map((g, i) => `<div class="wgroup">
      <div class="wg-head"><b>Group ${i + 1}</b>
        <select data-bind="variant.weaponGroups.${i}.mode">${["LINKED", "ALTERNATING"].map((m) => `<option${g.mode === m ? " selected" : ""}>${m}</option>`).join("")}</select>
        <label><input type="checkbox" data-bind="variant.weaponGroups.${i}.autofire" ${g.autofire ? "checked" : ""} style="width:auto"> Autofire</label>
        <span class="spacer"></span>${Object.keys(g.weapons || {}).length ? "" : `<button data-act="deleteGroup" data-g="${i}" title="Delete this empty group">✕</button>`}</div>
      ${Object.entries(g.weapons || {}).map(([slot, wid]) => `<div class="wg-row"><span class="grow">${esc(slot)} · ${esc((S.weapons[wid] || {}).name || wid)}</span>
        <select data-movew="${esc(slot)}">${opts(i)}</select></div>`).join("") || '<div class="muted" style="font-size:12px">Empty</div>'}
    </div>`).join("") || '<p class="muted">No weapons fitted.</p>'}
    <div class="btnrow"><button data-act="newGroup" ${gs.length >= 7 ? "disabled" : ""}>Add group</button></div>`;
}
function moveWeaponToGroup(slot, target) {
  edit(() => {
    const gs = S.cur.variant.weaponGroups;
    let wid = null;
    for (const g of gs) if (slot in g.weapons) { wid = g.weapons[slot]; delete g.weapons[slot]; }
    if (!wid) return;
    if (target === "new") gs.push({ autofire: false, mode: "LINKED", weapons: { [slot]: wid } });
    else gs[+target].weapons[slot] = wid;
  });
}

// ================================================================ CHECKS
function checkShip(c) {
  const out = [], sh = c.ship, v = c.variant || { weaponGroups: [], hullMods: [], wings: [] };
  const add = (level, msg, go) => out.push({ level, msg, go });
  const hasSkinSys = c.skin && c.skin.systemId;
  // sprite
  if (c.imgError) add("error", `Sprite file not found: ${c.sprite}`, { mode: "view" });
  else if (c.img && sh.width && sh.height && (c.img.naturalWidth !== sh.width || c.img.naturalHeight !== sh.height))
    add("warn", `Sprite is ${c.img.naturalWidth}×${c.img.naturalHeight} px but the hull says ${sh.width}×${sh.height}.`, { mode: "centers" });
  // basics
  if (!c.isSkin && !c.csv.id) add("error", "No ship_data.csv row for this hull: the game needs one.", { mode: "view" });
  if (!sh.hullSize) add("error", "The hull file has no hullSize.", { mode: "view" });
  const ids = {};
  sh.weaponSlots.forEach((s, i) => { (ids[s.id] = ids[s.id] || []).push(i); });
  for (const [id, is] of Object.entries(ids)) if (is.length > 1) add("error", `Slot id "${id}" is used ${is.length} times.`, { mode: "slots", sel: { kind: "slot", i: is[1], p: 0 } });
  if (c.img) {
    const W = c.img.naturalWidth, H = c.img.naturalHeight, cx = sh.center[0], cy = sh.center[1];
    sh.weaponSlots.forEach((s, i) => {
      const l = loc(s), px = cx - l[1], py = H - cy - l[0];
      if (px < -2 || py < -2 || px > W + 2 || py > H + 2) add("warn", `Slot ${s.id} is outside the sprite.`, { mode: "slots", sel: { kind: "slot", i, p: 0 } });
    });
  }
  if (c.isSkin) {
    const baseIds = new Set(c.base.weaponSlots.map((s) => s.id));
    sh.weaponSlots.forEach((s, i) => { if (!baseIds.has(s.id)) add("error", `Slot ${s.id} isn't on the base hull; skins can't add slots.`, { mode: "slots", sel: { kind: "slot", i, p: 0 } }); });
  } else {
    if ((sh.bounds || []).length < 6) add("warn", "No collision bounds (needs at least 3 points).", { mode: "bounds" });
    else {
      let far = 0; for (let k = 0; k + 1 < sh.bounds.length; k += 2) far = Math.max(far, Math.hypot(sh.bounds[k], sh.bounds[k + 1]));
      if ((sh.collisionRadius || 0) < far - 0.5) add("warn", `Collision radius (${sh.collisionRadius || 0}) is smaller than the bounds (${Math.ceil(far)}).`, { mode: "centers" });
    }
    if (/FRONT|OMNI/.test(c.csv["shield type"] || "") && !(sh.shieldRadius > 0)) add("warn", "The ship has a shield but shieldRadius is 0.", { mode: "centers" });
  }
  // systems
  if (S.systemIds) {
    const sys = hasSkinSys ? c.skin.systemId : c.csv["system id"];
    if (sys && !S.systemIds.has(sys)) add("warn", `Ship system "${sys}" isn't loaded.`, { mode: "view" });
    if (c.csv["defense id"] && !S.systemIds.has(c.csv["defense id"])) add("warn", `Defense system "${c.csv["defense id"]}" isn't loaded.`, { mode: "view" });
  }
  // built-ins
  for (const m of sh.builtInMods || []) if (!S.hullmodById[m]) add("error", `Built-in hullmod "${m}" doesn't exist.`, { mode: "variant" });
  for (const [slot, w] of Object.entries(sh.builtInWeapons || {})) {
    const i = sh.weaponSlots.findIndex((s) => s.id === slot);
    if (i < 0) add("error", `Built-in weapon ${w} is on slot ${slot}, which doesn't exist.`, { mode: "slots" });
    else if (!S.weapons[w]) add("error", `Built-in weapon "${w}" on ${slot} doesn't exist.`, { mode: "slots", sel: { kind: "slot", i, p: 0 } });
  }
  for (const w of sh.builtInWings || []) if (!S.wingById[w]) add("error", `Built-in wing "${w}" doesn't exist.`, { mode: "variant" });
  if ((sh.builtInWings || []).length > fighterBays(c)) add("warn", `${sh.builtInWings.length} built-in wings but only ${fighterBays(c)} fighter bays.`, { mode: "variant" });
  // variant
  const sw = {};
  for (const g of v.weaponGroups || []) Object.assign(sw, g.weapons || {});
  for (const [slot, w] of Object.entries(sw)) {
    const i = sh.weaponSlots.findIndex((s) => s.id === slot), wd = S.weapons[w];
    if (i < 0) add("error", `Variant fits ${w} on slot ${slot}, which doesn't exist.`, { mode: "variant" });
    else if (!wd) add("error", `Variant weapon "${w}" on ${slot} doesn't exist.`, { mode: "variant", sel: { kind: "slot", i, p: 0 } });
    else if (wd._size && wd._mountType && !weaponFits(sh.weaponSlots[i], wd)) add("warn", `${wd.name || w} doesn't fit ${slot} (${sh.weaponSlots[i].size} ${sh.weaponSlots[i].type}).`, { mode: "variant", sel: { kind: "slot", i, p: 0 } });
  }
  for (const m of v.hullMods || []) if (!S.hullmodById[m]) add("error", `Variant hullmod "${m}" doesn't exist.`, { mode: "variant" });
  for (const w of v.wings || []) if (w && !S.wingById[w]) add("error", `Variant wing "${w}" doesn't exist.`, { mode: "variant" });
  if (c.variant) {
    const b = opBudget();
    if (sh.hullSize !== "FIGHTER" && b.used > b.total) add("warn", `Variant uses ${b.used} OP of ${b.total}.`, { mode: "variant" });
    const maxV = MAX_VENTS[sh.hullSize] ?? 30;
    if ((v.fluxVents || 0) > maxV || (v.fluxCapacitors || 0) > maxV) add("warn", `More than ${maxV} vents or capacitors (the limit without skills).`, { mode: "variant" });
    for (const [slot, mv] of Object.entries(variantModules(v))) {
      const s = sh.weaponSlots.find((x) => x.id === slot);
      if (!s || s.type !== "STATION_MODULE") add("error", `Module ${mv} is on ${slot}, which isn't a STATION_MODULE slot.`, { mode: "variant" });
      const info = S.modCache[mv];
      if (info && info.ready && info.missing) add("error", `Module variant "${mv}" doesn't exist.`, { mode: "variant" });
    }
  }
  // content from other mods
  const allowed = new Set(["starsector-core", c.file.source, c.base && (S.hullById[c.skin.baseHullId] || {}).source].filter(Boolean));
  const deps = new Set();
  const note = (src) => { if (src && !allowed.has(src)) deps.add(src); };
  for (const w of Object.values(sw).concat(Object.values(sh.builtInWeapons || {}))) note((S.weapons[w] || {})._source);
  for (const m of (v.hullMods || []).concat(sh.builtInMods || [])) note((S.hullmodById[m] || {})._source);
  for (const w of (v.wings || []).concat(sh.builtInWings || [])) note(w && (S.wingById[w] || {})._source);
  if (deps.size) add("info", `Uses content from other mods: ${[...deps].map((d) => (sourceById(d) || {}).name || d).join(", ")}. Players will need them installed.`);
  return out;
}

// ================================================================ DIALOGS
function openDialog(title, okLabel, html, onOk) {
  $("#dlg-title").textContent = title;
  $("#dlg-cancel").style.display = ""; $("#dlg-body").onclick = null; $("#dlg .modal-box").classList.remove("mm-box");
  $("#dlg-ok").textContent = okLabel;
  $("#dlg-body").innerHTML = html;
  $("#dlg").classList.remove("hidden");
  const f = $("#dlg-body").querySelector("input,select"); if (f) f.focus();
  $("#dlg-ok").onclick = async () => {
    $("#dlg-ok").disabled = true;
    try { if ((await onOk($("#dlg-body"))) !== false) closeDialog(); }
    catch (e) { toast(String(e.message || e), true); }
    finally { $("#dlg-ok").disabled = false; }
  };
}
function closeDialog() { $("#dlg").classList.add("hidden"); }
$("#dlg-cancel").onclick = closeDialog;
$("#dlg").onclick = (e) => { if (e.target.id === "dlg") closeDialog(); };
const dv = (root, name) => { const el = root.querySelector(`[name="${name}"]`); return el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : ""; };
const SIZE_TEMPLATES = { FIGHTER: "broadsword", FRIGATE: "wolf", DESTROYER: "hammerhead", CRUISER: "eagle", CAPITAL_SHIP: "conquest" };

function idTaken(id) { return !!(S.hullById[id] || S.shipDocs[id]); }
function readFileAsDataUrl(file) { return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); }); }
function imageSize(src) { return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => bad(new Error("Couldn't load that image.")); i.src = src; }); }
const spriteChooser = (def) => `
  <label>Sprite</label><div>${imgFieldHtml(`<input name="spritePath" value="${esc(def || "")}" placeholder="graphics/ships/…png (an image already in the game or a mod)">`, def, "graphics/ships")}
  <div class="muted" style="font-size:11px;margin:4px 0">…or upload a PNG (it's added to the Changes list and saved into your Save-to mod):</div>
  <input type="file" name="spriteFile" accept="image/png"></div>`;
/** Resolves the sprite fields to {rel, upload, w, h}. */
async function resolveSprite(root, id) {
  const file = root.querySelector('[name="spriteFile"]').files[0];
  if (file) {
    const dataUrl = await readFileAsDataUrl(file), [w, h] = await imageSize(dataUrl);
    const rel = `graphics/ships/${id}.png`;
    return { rel, w, h, upload: { rel, dataUrl, base64: dataUrl.split(",")[1] } };
  }
  const rel = dv(root, "spritePath");
  if (!rel) throw new Error("Choose a sprite: a path to an existing image or a PNG upload.");
  const [w, h] = await imageSize(asset(rel));
  return { rel, w, h, upload: null };
}
function registerHullListEntry(c, kind) {
  const e = { hullId: c.id, hullName: tabName(c), hullSize: c.ship.hullSize, kind, source: "(new)", spriteName: spriteOf(c), baseHullId: c.skin && c.skin.baseHullId };
  S.hulls = S.hulls.filter((h) => h.hullId !== c.id).concat([e]).sort((a, b) => (a.hullName || a.hullId).localeCompare(b.hullName || b.hullId));
  S.hullById[c.id] = e; renderHullList();
}
function openNewDoc(c, variant) {
  const prev = S.cur; S.cur = c;
  if (variant) { c.variant = normalizeVariant(variant); c.variantOrig = "null"; c.variantFile = null; } else newVariant();
  S.cur = prev;
  switchTab(c); scheduleSync();
  if (!$("#save-target").value) toast("Pick a “Save to mod” before saving: new files are written there.", true);
}

function newHullDialog() {
  const styles = Object.keys(S.styles.hull || {}).filter((k) => !/^(sounds|DEFAULT|FIGHTER|FRIGATE|DESTROYER|CRUISER|CAPITAL_SHIP)$/.test(k));
  openDialog("New hull", "Create hull", `<div class="form">
      <label>Hull id</label><input name="id" placeholder="e.g. mymod_falcon">
      <label>Name</label><input name="name" placeholder="Falcon">
      <label>Designation</label><input name="designation" placeholder="Cruiser">
      <label>Hull size</label><select name="size">${["FIGHTER", "FRIGATE", "DESTROYER", "CRUISER", "CAPITAL_SHIP"].map((x) => `<option${x === "CRUISER" ? " selected" : ""}>${x}</option>`).join("")}</select>
      <label>Style</label><select name="style">${styles.map((x) => `<option${x === "MIDLINE" ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
      <label>Copy stats from</label><input name="template" placeholder="(by size: eagle for cruisers…)" list="hull-ids">
      ${spriteChooser("")}
    </div><datalist id="hull-ids">${S.hulls.filter((h) => h.kind === "ship").slice(0, 4000).map((h) => `<option value="${esc(h.hullId)}">`).join("")}</datalist>
    <p class="muted" style="font-size:12px">Creates the .ship file, its ship_data.csv row and a description, all listed in Changes. Stats start as a copy of the chosen hull so the ship is playable; adjust them in View mode, then lay out slots, engines and bounds.</p>`,
  async (root) => {
    const id = dv(root, "id"), name = dv(root, "name") || id, size = dv(root, "size");
    if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("The hull id may only use letters, digits, _ - and .");
    if (idTaken(id)) throw new Error(`A hull called "${id}" already exists.`);
    const sp = await resolveSprite(root, id);
    let tId = dv(root, "template");
    if (!tId) {
      const pref = SIZE_TEMPLATES[size];
      const h = S.hullById[pref] ? S.hullById[pref] : S.hulls.find((x) => x.kind === "ship" && x.hullSize === size) || S.hulls.find((x) => x.kind === "ship" && x.hullSize !== "FIGHTER");
      tId = h ? h.hullId : pref;
    }
    const t = await api("/api/hull?id=" + encodeURIComponent(tId)).catch(() => null);
    if (!t || !t.csv) throw new Error(`Couldn't load stats from "${tId}".`);
    const csv = Object.assign(clone(t.csv), { id, name, designation: dv(root, "designation") || t.csv.designation, _file: null, _source: null, _template: t.csv._file });
    const r = Math.ceil(Math.hypot(sp.w, sp.h) / 2);
    const ship = { bounds: [], builtInMods: [], builtInWeapons: {}, builtInWings: [], center: [sp.w / 2, sp.h / 2], collisionRadius: r, engineSlots: [],
      height: sp.h, hullId: id, hullName: name, hullSize: size, shieldCenter: [0, 0], shieldRadius: r, spriteName: sp.rel, style: dv(root, "style"),
      viewOffset: 0, weaponSlots: [], width: sp.w };
    const c = makeShipDoc({ id, data: { ship, csv, file: { path: null, source: null } }, desc: { id, type: "SHIP", text1: "", _file: null, _source: null }, isNew: true, spriteUpload: sp.upload });
    registerHullListEntry(c, "ship");
    openNewDoc(c);
    setMode("bounds");
    toast("New hull created. Try Generate bounds first, then add slots and engines.");
  });
}
function duplicateHullDialog() {
  const src = S.cur;
  openDialog(`Duplicate ${tabName(src)}`, "Duplicate", `<div class="form">
      <label>New hull id</label><input name="id" value="${esc(src.id)}_mk2">
      <label>Name</label><input name="name" value="${esc(tabName(src))} Mk.II">
      <label>Copy current variant</label><input type="checkbox" name="withVariant" checked style="width:auto">
    </div><p class="muted" style="font-size:12px">Copies the hull file, stats row and description (including unsaved edits) under the new id. The sprite is shared.</p>`,
  async (root) => {
    const id = dv(root, "id"), name = dv(root, "name") || id;
    if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("The hull id may only use letters, digits, _ - and .");
    if (idTaken(id)) throw new Error(`A hull called "${id}" already exists.`);
    const ship = Object.assign(clone(src.ship), { hullId: id, hullName: name });
    const csv = Object.assign(clone(src.csv), { id, name, _file: null, _source: null, _template: src.csv._file || src.csv._template });
    const desc = Object.assign(clone(src.desc || { text1: "" }), { id, type: "SHIP", _file: null, _source: null });
    const c = makeShipDoc({ id, data: { ship, csv, file: { path: null, source: null } }, desc, isNew: true, spriteUpload: src.spriteUpload });
    registerHullListEntry(c, "ship");
    const v = dv(root, "withVariant") && src.variant ? Object.assign(clone(src.variant), { hullId: id, variantId: id + "_" + (src.variant.variantId.split("_").pop() || "custom") }) : null;
    openNewDoc(c, v);
  });
}
function newSkinDialog() {
  const base = S.cur;
  openDialog(`New skin of ${tabName(base)}`, "Create skin", `<div class="form">
      <label>Skin hull id</label><input name="id" value="${esc(base.id)}_xiv">
      <label>Name</label><input name="name" value="${esc(tabName(base))} (XIV)">
      <label>Description prefix</label><textarea name="prefix" rows="3" placeholder="Shown before the base hull's description"></textarea>
      ${spriteChooser(spriteOf(base))}
    </div><p class="muted" style="font-size:12px">A .skin inherits geometry and stats from the base hull. You can then change or remove slots and engines, swap built-ins and override OP, fleet points, system and more. The base .ship is never changed.</p>`,
  async (root) => {
    const id = dv(root, "id"), name = dv(root, "name") || id;
    if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("The skin id may only use letters, digits, _ - and .");
    if (idTaken(id)) throw new Error(`A hull called "${id}" already exists.`);
    const sp = await resolveSprite(root, id);
    const skin = { baseHullId: base.id, skinHullId: id, hullName: name, descriptionId: base.id, descriptionPrefix: dv(root, "prefix"),
      spriteName: sp.rel, tags: [], removeWeaponSlots: [], removeEngineSlots: [], removeBuiltInMods: [], removeBuiltInWeapons: [], builtInMods: [], builtInWeapons: {} };
    const c = makeShipDoc({ id, data: { skin, baseShip: clone(base.ship), csv: base.csv, file: { path: null, source: null } }, baseDesc: base.desc, isNew: true, spriteUpload: sp.upload });
    registerHullListEntry(c, "skin");
    openNewDoc(c);
  });
}
function newModDialog() {
  openDialog("New mod", "Create mod", `<div class="form">
      <label>Mod name</label><input name="name" placeholder="My Ships">
      <label>Mod id</label><input name="id" placeholder="my_ships">
      <label>Version</label><input name="version" value="1.0.0">
      <label>Author</label><input name="author">
      <label>Game version</label><input name="gameVersion" value="0.98.5a">
      <label>Description</label><textarea name="description" rows="3"></textarea>
      <label>Enable in launcher</label><input type="checkbox" name="enable" checked style="width:auto">
      <label>Version Checker files</label><input type="checkbox" name="versionChecker" style="width:auto">
    </div><p class="muted" style="font-size:12px">Creates <b>mods/&lt;name&gt;/mod_info.json</b> right away (not via Changes) and selects it as the Save-to mod. “Enable” adds it to enabled_mods.json (backed up first).</p>`,
  async (root) => {
    const body = { name: dv(root, "name"), id: dv(root, "id"), version: dv(root, "version") || "1.0.0", author: dv(root, "author"),
      gameVersion: dv(root, "gameVersion"), description: dv(root, "description"), enable: dv(root, "enable"), versionChecker: dv(root, "versionChecker") };
    if (!body.name || !body.id) throw new Error("Give the mod a name and an id.");
    const r = await api("/api/newmod", body);
    S.sources.push(r.source);
    refreshSourceSelects(r.source.id);
    toast(`Created ${r.source.name} (${r.created.length} file${r.created.length > 1 ? "s" : ""}) and selected it as the Save-to mod.`);
  });
}
function refreshSourceSelects(selectId) {
  const tgt = $("#save-target"), cur = selectId || tgt.value;
  tgt.length = 0; tgt.add(new Option("— choose a mod —", ""));
  for (const s of S.sources.filter((x) => !x.core).sort((a, b) => (b.enabled - a.enabled) || a.name.localeCompare(b.name)))
    tgt.add(new Option(s.name + (s.enabled ? "" : " (disabled)"), s.id));
  tgt.value = cur; localStorage.setItem("forge.saveTarget", cur);
  tgt.dispatchEvent(new Event("change"));
  fillListSourceFilters();
}
$("#new-hull").onclick = newHullDialog;
$("#new-mod").onclick = newModDialog;

document.head.insertAdjacentHTML("beforeend", `<style>
.chk-err { background: #4a1d1d; border-color: var(--bad); color: #ffc4c4; }
.chk-warn { background: #4a3a1d; border-color: var(--warn); color: #ffe2a8; }
.chk-ok { color: var(--good); font-size: 12px; align-self: center; }
.checks { display: flex; flex-direction: column; gap: 3px; }
.chk { padding: 4px 8px; border-radius: 4px; font-size: 12px; background: var(--panel2); border-left: 3px solid var(--line); }
.chk.error { border-left-color: var(--bad); } .chk.warn { border-left-color: var(--warn); } .chk.info { border-left-color: var(--accent); }
.chk[data-act] { cursor: pointer; } .chk[data-act]:hover { background: #1d3550; }
.hint-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.hchip { font-size: 11px; padding: 2px 7px; border-radius: 10px; color: var(--muted); }
.hchip.on { background: #1d4a33; border-color: var(--good); color: var(--good); }
.wgroup { border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; background: var(--panel2); }
.wg-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.wg-head select { padding: 2px 4px; }
.wg-row { display: flex; gap: 6px; align-items: center; font-size: 12px; padding: 2px 0; }
.wg-row .grow { flex: 1; }
.wg-row select { padding: 1px 4px; font-size: 12px; }
.rawjson { font: 11px/1.4 Consolas, monospace; background: #0a0f15; padding: 8px; border-radius: 4px; max-height: 300px; overflow: auto; }
#ship-detail .form textarea { width: 100%; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 4px; font: inherit; }
</style>`);

// ================================================================ IMAGE BROWSER
/* Browse every image under graphics/ in the game and all loaded mods (mods override by path). */
const IB = { data: null, dirs: null, dir: "graphics", q: "", src: "", sel: null, open: new Set(), onPick: null };
async function loadImageIndex(force) {
  if (IB.data && !force) return;
  const d = await api("/api/images");
  const dirs = new Map();
  const dirOf = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const node = (p) => { let n = dirs.get(p); if (!n) { n = { path: p, subs: new Set(), files: [], count: {} }; dirs.set(p, n); } return n; };
  const files = d.files.map(([rel, si]) => ({ rel, name: rel.slice(rel.lastIndexOf("/") + 1), src: d.sources[si] }));
  for (const f of files) {
    let p = dirOf(f.rel); node(p).files.push(f);
    for (;;) {
      const n = node(p); n.count[""] = (n.count[""] || 0) + 1; n.count[f.src] = (n.count[f.src] || 0) + 1;
      if (!p.includes("/")) break;
      const parent = dirOf(p); node(parent).subs.add(p); p = parent;
    }
  }
  IB.data = { files, sources: d.sources }; IB.dirs = dirs;
}
function ensureImageModal() {
  if ($("#imgb")) return;
  document.body.insertAdjacentHTML("beforeend", `
<div id="imgb" class="modal hidden"><div class="modal-box imgb-box">
  <div class="toolbar"><b id="imgb-title">Choose image</b>
    <input id="imgb-search" placeholder="Search all images by name or path…" style="flex:1">
    <select id="imgb-src" title="Filter by mod"><option value="">All mods</option></select>
    <button id="imgb-refresh" title="Rescan image folders">↻</button>
    <button id="imgb-close">Close</button></div>
  <div class="imgb-main"><div id="imgb-tree" class="imgb-tree"></div>
    <div class="imgb-right"><div id="imgb-crumbs" class="imgb-crumbs"></div><div id="imgb-grid" class="imgb-grid"></div></div></div>
  <div class="imgb-foot"><div id="imgb-prev" class="imgb-prev"></div>
    <button id="imgb-none" title="Clear the field">No image</button><button id="imgb-use" class="primary" disabled>Use image</button></div>
</div></div>`);
  $("#imgb-close").onclick = closeImageBrowser;
  $("#imgb").onclick = (e) => { if (e.target.id === "imgb") closeImageBrowser(); };
  $("#imgb-search").oninput = (e) => { IB.q = e.target.value.trim().toLowerCase(); renderImgGrid(); };
  $("#imgb-src").onchange = (e) => { IB.src = e.target.value; renderImgTree(); renderImgGrid(); };
  $("#imgb-refresh").onclick = async () => { await loadImageIndex(true); renderImgTree(); renderImgGrid(); toast(`${IB.data.files.length} images`); };
  $("#imgb-none").onclick = () => { const f = IB.onPick; closeImageBrowser(); f && f(""); };
  $("#imgb-use").onclick = () => { if (!IB.sel) return; const f = IB.onPick, v = IB.sel; closeImageBrowser(); f && f(v); };
  $("#imgb-tree").onclick = (e) => {
    const t = e.target.closest("[data-dir]"); if (!t) return;
    if (e.target.classList.contains("tw")) { IB.open.has(t.dataset.dir) ? IB.open.delete(t.dataset.dir) : IB.open.add(t.dataset.dir); renderImgTree(); return; }
    goImgDir(t.dataset.dir);
  };
  $("#imgb-crumbs").onclick = (e) => { const t = e.target.closest("[data-dir]"); if (t) goImgDir(t.dataset.dir); };
  $("#imgb-grid").onclick = (e) => {
    const t = e.target.closest(".imgb-tile"); if (!t) return;
    if (t.dataset.dir) return goImgDir(t.dataset.dir);
    IB.sel = t.dataset.rel; document.querySelectorAll("#imgb-grid .imgb-tile.sel").forEach((x) => x.classList.remove("sel")); t.classList.add("sel"); renderImgPreview();
  };
  $("#imgb-grid").ondblclick = (e) => { const t = e.target.closest(".imgb-tile"); if (t && t.dataset.rel) { IB.sel = t.dataset.rel; $("#imgb-use").click(); } };
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#imgb").classList.contains("hidden")) { e.stopImmediatePropagation(); e.preventDefault(); closeImageBrowser(); } }, true);
}
function closeImageBrowser() { $("#imgb").classList.add("hidden"); IB.onPick = null; }
/** opts: { title, current, start, onPick(relPath) } */
async function openImageBrowser(opts) {
  ensureImageModal();
  $("#imgb-title").textContent = opts.title || "Choose image";
  $("#imgb").classList.remove("hidden");
  $("#imgb-grid").innerHTML = '<p class="muted">Scanning image folders…</p>';
  try { await loadImageIndex(); } catch (e) { $("#imgb-grid").innerHTML = `<p class="muted">Couldn't list images: ${esc(e.message || e)}</p>`; return; }
  IB.onPick = opts.onPick; IB.q = ""; $("#imgb-search").value = "";
  const cur = String(opts.current || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const hit = IB.data.files.find((f) => f.rel.toLowerCase() === cur.toLowerCase());
  IB.sel = hit ? hit.rel : null;
  const curDir = hit ? hit.rel.slice(0, hit.rel.lastIndexOf("/")) : null;
  let dir = curDir || opts.start || "graphics";
  while (dir && !IB.dirs.has(dir)) dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  const sel = $("#imgb-src"), keep = IB.src; sel.length = 1;
  for (const o of sourceOptions(Object.keys(IB.dirs.get("graphics") ? IB.dirs.get("graphics").count : {}).filter(Boolean))) sel.add(new Option(`${o.label} (${IB.dirs.get("graphics").count[o.id]})`, o.id));
  sel.value = keep; if (sel.value !== keep) IB.src = "";
  goImgDir(dir || "graphics");
  $("#imgb-search").focus();
}
function goImgDir(dir) {
  IB.dir = dir; IB.q = ""; $("#imgb-search").value = "";
  for (let p = dir; p.includes("/"); p = p.slice(0, p.lastIndexOf("/"))) IB.open.add(p.slice(0, p.lastIndexOf("/")));
  IB.open.add(dir);
  renderImgTree(); renderImgGrid();
  const s = $("#imgb-tree .cur"); if (s) s.scrollIntoView({ block: "nearest" });
}
const imgCount = (n) => (n ? n.count[IB.src || ""] || 0 : 0);
function renderImgTree() {
  const rows = [];
  const walk = (p, depth) => {
    const n = IB.dirs.get(p); if (!imgCount(n)) return;
    const subs = [...n.subs].filter((s) => imgCount(IB.dirs.get(s))).sort((a, b) => a.localeCompare(b));
    const open = IB.open.has(p);
    rows.push(`<div class="imgb-dir${p === IB.dir ? " cur" : ""}" data-dir="${esc(p)}" style="padding-left:${depth * 14 + 4}px">
      <span class="tw">${subs.length ? (open ? "▾" : "▸") : ""}</span>${esc(p.slice(p.lastIndexOf("/") + 1))} <span class="muted">${imgCount(n)}</span></div>`);
    if (open) for (const s of subs) walk(s, depth + 1);
  };
  const roots = [...IB.dirs.keys()].filter((p) => !p.includes("/"));
  for (const r of roots.sort()) walk(r, 0);
  $("#imgb-tree").innerHTML = rows.join("") || '<p class="muted">No images.</p>';
}
function imgTile(f) {
  return `<div class="imgb-tile${f.rel === IB.sel ? " sel" : ""}" data-rel="${esc(f.rel)}" title="${esc(f.rel)}">
    <div class="th"><img loading="lazy" class="imgb-th" src="${asset(f.rel)}" alt=""></div>
    <div class="nm">${esc(f.name)}</div>
    <div class="sr"><span class="dm" data-s="${IB.src ? "" : 1}"></span>${IB.src ? "" : esc(srcLabel(f.src))}</div></div>`;
}
const srcLabel = (id) => { const s = sourceById(id); return s ? (s.core ? "Vanilla" : s.name) : id; };
function renderImgGrid() {
  const ok = (f) => !IB.src || f.src === IB.src;
  let html = "";
  if (IB.q) {
    const terms = IB.q.split(/\s+/);
    const list = IB.data.files.filter((f) => ok(f) && terms.every((t) => f.rel.toLowerCase().includes(t)));
    $("#imgb-crumbs").innerHTML = `<span class="muted">${list.length} match${list.length === 1 ? "" : "es"} for “${esc(IB.q)}”${list.length > 400 ? " (showing 400)" : ""}</span>`;
    html = list.slice(0, 400).map(imgTile).join("");
  } else {
    const parts = IB.dir.split("/");
    $("#imgb-crumbs").innerHTML = parts.map((p, i) => `<a data-dir="${esc(parts.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join(" / ");
    const n = IB.dirs.get(IB.dir);
    const subs = n ? [...n.subs].filter((s) => imgCount(IB.dirs.get(s))).sort((a, b) => a.localeCompare(b)) : [];
    html = subs.map((s) => `<div class="imgb-tile folder" data-dir="${esc(s)}"><div class="th">📁</div><div class="nm">${esc(s.slice(s.lastIndexOf("/") + 1))}</div><div class="sr">${imgCount(IB.dirs.get(s))} images</div></div>`).join("")
      + (n ? n.files.filter(ok).sort((a, b) => a.name.localeCompare(b.name)).map(imgTile).join("") : "");
  }
  $("#imgb-grid").innerHTML = html || '<p class="muted">No images here.</p>';
  $("#imgb-grid").scrollTop = 0;
  renderImgPreview();
  const s = $("#imgb-grid .imgb-tile.sel"); if (s) s.scrollIntoView({ block: "center" });
}
function renderImgPreview() {
  const f = IB.sel && IB.data.files.find((x) => x.rel === IB.sel);
  $("#imgb-use").disabled = !f;
  $("#imgb-prev").innerHTML = f ? `<img class="imgb-prev-img" src="${asset(f.rel)}" alt="">
    <div><div style="word-break:break-all">${esc(f.rel)}</div><div class="muted"><span class="dim"></span> · ${esc(srcLabel(f.src))}</div></div>` : '<span class="muted">Click an image to select it, double-click to use it.</span>';
}

/** Wraps a text input with a Browse… button (and a small thumbnail). start = folder to open when the field is empty. */
function imgFieldHtml(inputHtml, value, start) {
  return `<div class="imgfield"><img class="imgf-th" src="${value ? asset(value) : ""}" alt="" ${value ? "" : 'style="visibility:hidden"'}>${inputHtml}<button type="button" class="browse-img" data-start="${esc(start || "graphics")}">Browse…</button></div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".browse-img"); if (!b) return;
  e.preventDefault();
  const wrap = b.closest(".imgfield"), input = wrap.querySelector("input");
  openImageBrowser({
    title: "Choose image" + (input.dataset.wpn ? ` for ${input.dataset.wpn}` : ""), current: input.value, start: b.dataset.start,
    onPick: (v) => {
      input.value = v;
      const th = wrap.querySelector(".imgf-th"); if (th) { th.style.visibility = v ? "" : "hidden"; if (v) th.src = asset(v); }
      input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
});
document.addEventListener("input", (e) => {
  const wrap = e.target.closest && e.target.closest(".imgfield"); if (!wrap || e.target.tagName !== "INPUT" || !e.isTrusted) return;
  const th = wrap.querySelector(".imgf-th"), v = e.target.value.trim();
  if (th) { th.style.visibility = v ? "" : "hidden"; if (v) th.src = asset(v); }
});

document.head.insertAdjacentHTML("beforeend", `<style>
.imgb-box { width: min(1200px, 95vw); height: min(860px, 92vh); }
.imgb-main { flex: 1; display: flex; min-height: 0; }
.imgb-tree { width: 260px; flex: none; overflow: auto; border-right: 1px solid var(--line); padding: 6px 0; font-size: 13px; }
.imgb-dir { padding: 3px 6px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imgb-dir:hover { background: var(--panel2); }
.imgb-dir.cur { background: var(--panel2); color: var(--accent); }
.imgb-dir .tw { display: inline-block; width: 14px; color: #8aa; }
.imgb-right { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.imgb-crumbs { padding: 6px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
.imgb-crumbs a { cursor: pointer; color: var(--accent); }
.imgb-grid { flex: 1; overflow: auto; padding: 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; align-content: start; }
.imgb-tile { border: 1px solid var(--line); border-radius: 6px; background: var(--panel2); cursor: pointer; padding: 4px; font-size: 11px; min-width: 0; }
.imgb-tile:hover { border-color: var(--accent); }
.imgb-tile.sel { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
.imgb-tile .th { height: 92px; display: flex; align-items: center; justify-content: center; font-size: 42px;
  background: repeating-conic-gradient(#1b2430 0 25%, #222d3a 0 50%) 0 0 / 14px 14px; border-radius: 4px; }
.imgb-tile .th img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
.imgb-tile .th img.up { width: 64px; height: 64px; object-fit: contain; }
.imgb-tile .nm { margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imgb-tile .sr { color: #7c8da3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imgb-tile.folder .th { background: none; }
.imgb-foot { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--line); }
.imgb-prev { flex: 1; display: flex; gap: 10px; align-items: center; min-width: 0; font-size: 12px; }
.imgb-prev img { max-height: 64px; max-width: 120px; image-rendering: pixelated; }
.imgfield { display: flex; gap: 6px; align-items: center; min-width: 0; }
.imgfield input { flex: 1; min-width: 0; }
.imgfield .imgf-th { width: 26px; height: 26px; object-fit: contain; flex: none; image-rendering: pixelated; }
.imgfield button { flex: none; }
</style>`);

// attached-parts controls, click to open, hover
try { const v = localStorage.getItem("forge.attachMode"); if (v) $("#attach-mode").value = v; } catch (e) { /* ignore */ }
$("#attach-mode").addEventListener("change", () => { try { localStorage.setItem("forge.attachMode", $("#attach-mode").value); } catch (e) { /* ignore */ } draw(); });
$("#attach-parent").addEventListener("change", () => { const c = S.cur; if (c && c.parents) setParentRef(c, c.parents[+$("#attach-parent").value]); });
{
  let down = null;
  cv.addEventListener("mousedown", (e) => { down = ["view", "variant"].includes(S.mode) && e.button === 0 ? [e.clientX, e.clientY] : null; });
  window.addEventListener("mouseup", (e) => {
    const d = down; down = null;
    if (!d || !S.cur || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 4) return;
    if (S.mode === "variant" && hitPoint(e, S.cur.ship.weaponSlots.map(loc), 12) >= 0) return; // clicked a slot
    const r = cv.getBoundingClientRect(), p = partAt(e.clientX - r.left, e.clientY - r.top);
    if (p) openPart(p);
  });
  cv.addEventListener("mousemove", (e) => {
    if (!S.cur || V.drag || !["view", "variant"].includes(S.mode)) { if (cv.style.cursor === "pointer") cv.style.cursor = ""; return; }
    const r = cv.getBoundingClientRect(), p = partAt(e.clientX - r.left, e.clientY - r.top);
    const onSlot = S.mode === "variant" && hitPoint(e, S.cur.ship.weaponSlots.map(loc), 12) >= 0;
    cv.style.cursor = p && !onSlot ? "pointer" : "";
    if (p && !onSlot) $("#hover-info").textContent = partLabel(p) + " · click to open it";
  });
}

// image load/error handling without inline handlers (the page's security policy forbids inline script)
document.addEventListener("load", (e) => {
  const im = e.target; if (!(im instanceof HTMLImageElement)) return;
  if (im.classList.contains("imgb-th")) {
    const t = im.closest(".imgb-tile"), d = t && t.querySelector(".dm");
    if (d) d.textContent = im.naturalWidth + "×" + im.naturalHeight + (d.dataset.s ? " · " : "");
    if (im.naturalWidth <= 64 && im.naturalHeight <= 64) im.classList.add("up");
  } else if (im.classList.contains("imgb-prev-img")) {
    const d = im.nextElementSibling && im.nextElementSibling.querySelector(".dim");
    if (d) d.textContent = im.naturalWidth + " × " + im.naturalHeight + " px";
  }
}, true);
document.addEventListener("error", (e) => { if (e.target instanceof HTMLImageElement && e.target.classList.contains("imgf-th")) e.target.style.visibility = "hidden"; }, true);
