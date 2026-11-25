// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Starforge — standalone Starsector ship editor. Talks to the local Java server (/api/*) or, in the browser version, to local/*.js,
// which reads vanilla + mods and writes only inside the mods folder.

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => (v === "" || v == null || isNaN(+v) ? null : +v);
const asset = (p) => (p ? (window.FORGE_ASSET ? window.FORGE_ASSET(p) : "/asset/" + encodeURI(String(p).replace(/\\/g, "/"))) : "");
const clone = (o) => JSON.parse(JSON.stringify(o));
const r2 = (v) => Math.round(v * 100) / 100;

async function api(path, body) {
  if (window.FORGE_LOCAL) return FORGE_LOCAL.api(path, body); // browser version: answered in the page
  const opt = body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Forge": "1" } };
  for (;;) {
    const r = await fetch(path, opt);
    if (r.status === 503) { await new Promise((ok) => setTimeout(ok, 500)); continue; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
}

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg; t.className = bad ? "bad" : ""; t.style.display = "block";
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = "none"), bad ? 6000 : 3000);
}

/** JSON in Starsector's usual layout: objects indented, short number/string arrays kept on one line. */
function prettyJson(v, ind = "") {
  const pad = ind + "    ";
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object" || x === null) && JSON.stringify(v).length < 100) return JSON.stringify(v).replace(/,/g, ", ");
    if (!v.length) return "[]";
    return "[\n" + v.map((x) => pad + prettyJson(x, pad)).join(",\n") + "\n" + ind + "]";
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return "{\n" + keys.map((k) => pad + JSON.stringify(k) + ": " + prettyJson(v[k], pad)).join(",\n") + "\n" + ind + "}";
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- constants
const SLOT_COLORS = {
  BALLISTIC: "#f2c94c", ENERGY: "#56ccf2", MISSILE: "#6fcf97", COMPOSITE: "#c9e265", HYBRID: "#f2994a",
  SYNERGY: "#5fd3c0", UNIVERSAL: "#e0e0e0", BUILT_IN: "#9b8cff", DECORATIVE: "#8a8a8a", SYSTEM: "#8a8a8a",
  LAUNCH_BAY: "#c39bff", STATION_MODULE: "#ff7ab6",
};
const SLOT_TYPES = Object.keys(SLOT_COLORS);

// User-adjustable overlay colours (persisted in the browser).
const THEME_DEFAULTS = {
  arcMode: "type", arcColor: "#ff4fd8", arcOpacity: 15,
  bounds: "#6fd38f", select: "#4fc3e8", center: "#ff5c8a", shieldCenter: "#4fc3e8",
  collision: "#ff5c8a", engineHandle: "#ffb15c", mirror: "#ffffff", background: "#0b1017",
  checkerA: "#1a2230", checkerB: "#222c3c", labels: "#ffffff",
  slot: Object.assign({}, SLOT_COLORS),
};
let THEME = loadTheme();
function loadTheme() {
  try {
    const t = JSON.parse(localStorage.getItem("forge.theme") || "{}");
    return Object.assign({}, THEME_DEFAULTS, t, { slot: Object.assign({}, SLOT_COLORS, t.slot || {}) });
  } catch { return clone(THEME_DEFAULTS); }
}
function saveTheme() { localStorage.setItem("forge.theme", JSON.stringify(THEME)); draw(); }
const slotColor = (t) => THEME.slot[t] || "#dddddd";
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
const SIZES = ["SMALL", "MEDIUM", "LARGE"];
const MOUNTS = ["TURRET", "HARDPOINT", "HIDDEN"];
const COMPAT = {
  BALLISTIC: ["BALLISTIC"], ENERGY: ["ENERGY"], MISSILE: ["MISSILE"],
  COMPOSITE: ["BALLISTIC", "MISSILE", "COMPOSITE"], HYBRID: ["BALLISTIC", "ENERGY", "HYBRID"],
  SYNERGY: ["ENERGY", "MISSILE", "SYNERGY"],
  UNIVERSAL: ["BALLISTIC", "ENERGY", "MISSILE", "COMPOSITE", "HYBRID", "SYNERGY", "UNIVERSAL"],
  DECORATIVE: ["DECORATIVE"], BUILT_IN: ["BUILT_IN", "BALLISTIC", "ENERGY", "MISSILE", "COMPOSITE", "HYBRID", "SYNERGY", "UNIVERSAL"],
  SYSTEM: ["SYSTEM"], STATION_MODULE: ["STATION_MODULE"], LAUNCH_BAY: [],
};
const COST_COL = { FRIGATE: "cost_frigate", DESTROYER: "cost_dest", CRUISER: "cost_cruiser", CAPITAL_SHIP: "cost_capital", FIGHTER: "cost_frigate" };
const MAX_VENTS = { FRIGATE: 10, DESTROYER: 20, CRUISER: 30, CAPITAL_SHIP: 50, FIGHTER: 0 };
const ENGINE_DEFAULT_COLOR = [255, 125, 25, 255];
const HINTS = {
  view: "Scroll to zoom · drag to pan · double-click to fit",
  variant: "Click a slot to see its weapon · click it again to change the weapon · hullmods, wings and vents are in the panel on the right",
  slots: "Click to select · drag to move · Alt+drag to aim · Shift+click to add · Del to delete",
  engines: "Click to select · drag to move · Alt+drag to aim · Ctrl+drag to resize · Shift+click to add · Del to delete",
  bounds: "Drag points · Shift+click to insert a point on the nearest edge · Del to delete point",
  centers: "Drag the pink cross (ship center) or blue cross (shield center) · Alt+drag sets shield radius · Shift+drag sets collision radius",
};

// ---------------------------------------------------------------- state
const S = {
  hulls: [], hullById: {}, weapons: {}, wings: [], wingById: {}, hullmods: [], hullmodById: {},
  styles: { engine: {}, hull: {} }, sources: [], allVariants: null,
  cur: null, mode: "view", sel: null, tabs: [],
};
const FLAME = new Image(); FLAME.src = (window.FORGE_STATIC || {})["engineflame32.png"] || "/web/engineflame32.png";
const FLAME_CORE = new Image(); FLAME_CORE.src = (window.FORGE_STATIC || {})["engineflamecore32.png"] || "/web/engineflamecore32.png";
FLAME.onload = FLAME_CORE.onload = () => draw();

// ---------------------------------------------------------------- tabs
for (const b of document.querySelectorAll("#tabs button")) {
  b.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    if (b.dataset.tab === "ships") resizeCanvas();
  };
}

// ---------------------------------------------------------------- boot
async function boot() {
  $("#loading").classList.remove("hidden");
  const [summary, hulls, weapons, wings, hullmods, styles, settings] = await Promise.all([
    api("/api/summary"), api("/api/hulls"), api("/api/weapons"), api("/api/wings"), api("/api/hullmods"), api("/api/styles"), api("/api/settings"),
  ]);
  S.summary = summary;
  S.sources = summary.sources;
  S.hulls = hulls.sort((a, b) => (a.hullName || a.hullId).localeCompare(b.hullName || b.hullId));
  S.hullById = Object.fromEntries(hulls.map((h) => [h.hullId, h]));
  S.weapons = Object.fromEntries(weapons.map((w) => [w.id, w]));
  S.wings = wings; S.wingById = Object.fromEntries(wings.map((w) => [w.id, w]));
  S.hullmods = hullmods; S.hullmodById = Object.fromEntries(hullmods.map((h) => [h.id, h]));
  S.styles = styles;
  S.allVariants = null;
  S.settings = settings;
  if (typeof renderModMode === "function") renderModMode();

  fillListSourceFilters();
  const tgt = $("#save-target");
  tgt.length = 0;
  tgt.add(new Option("— choose a mod —", ""));
  for (const s of S.sources.filter((x) => !x.core).sort((a, b) => (b.enabled - a.enabled) || a.name.localeCompare(b.name)))
    tgt.add(new Option(s.name + (s.enabled ? "" : " (disabled)"), s.id));
  tgt.value = localStorage.getItem("forge.saveTarget") || "";
  tgt.onchange = () => localStorage.setItem("forge.saveTarget", tgt.value);

  const hmSrc = $("#hm-source"); hmSrc.length = 1;
  for (const o of sourceOptions(hullmods.map((h) => h._source))) hmSrc.add(new Option(o.label, o.id));
  renderHullList(); renderWeaponList(); renderWingList(); renderHullmods(); renderSources();
  $("#loading").classList.add("hidden");
}
const sourceById = (id) => S.sources.find((s) => s.id === id);
/** Fills a "filter by mod" select with the mods that have items in the list, with counts; remembers the choice. */
function fillSourceFilter(sel, ids, key) {
  const counts = {}; for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  const keep = sel.value || localStorage.getItem("forge.filter." + key) || "";
  sel.length = 1; sel.options[0].textContent = `All mods (${ids.length})`;
  for (const o of sourceOptions(ids)) {
    const s = sourceById(o.id);
    sel.add(new Option(`${o.label}${s && !s.core && !s.enabled ? " (disabled)" : ""} (${counts[o.id]})`, o.id));
  }
  sel.value = keep; if (sel.value !== keep) sel.value = "";
  if (!sel.dataset.persist) { sel.dataset.persist = 1; sel.addEventListener("change", () => localStorage.setItem("forge.filter." + key, sel.value)); }
}
function fillListSourceFilters() {
  fillSourceFilter($("#hull-source"), S.hulls.map((h) => h.source), "hulls");
  fillSourceFilter($("#weapon-source"), Object.values(S.weapons).map((w) => w._source), "weapons");
  fillSourceFilter($("#wing-source"), S.wings.map((w) => w._source), "wings");
}

// ================================================================ HULL LIST
function renderHullList() {
  const q = $("#hull-search").value.trim().toLowerCase();
  const src = $("#hull-source").value, size = $("#hull-size").value;
  const list = S.hulls.filter((h) =>
    (!src || h.source === src || h.source === "(new)") && (!size || (size === "!FIGHTER" ? h.hullSize !== "FIGHTER" : h.hullSize === size)) &&
    (!q || [h.hullName, h.hullId, h.source, h.designation].some((x) => x && String(x).toLowerCase().includes(q))));
  const hiddenF = size === "!FIGHTER" ? S.hulls.filter((h) => h.hullSize === "FIGHTER" && (!src || h.source === src) && (!q || [h.hullName, h.hullId, h.source, h.designation].some((x) => x && String(x).toLowerCase().includes(q)))).length : 0;
  $("#hull-count").textContent = list.length + " hulls" + (hiddenF ? ` (${hiddenF} fighter${hiddenF > 1 ? "s" : ""} hidden)` : "");
  const el = $("#hull-list");
  el.innerHTML = list.slice(0, 700).map((h) => `
    <div class="item${S.cur && S.cur.id === h.hullId ? " selected" : ""}" data-id="${esc(h.hullId)}">
      <img loading="lazy" src="${asset(h.spriteName)}" alt="">
      <div class="t"><div class="n">${esc(h.hullName || h.hullId)}${h.kind === "skin" ? ' <span class="muted">(skin)</span>' : ""}</div>
      <div class="s">${esc(h.hullId)} · ${esc((h.hullSize || "").replace("_SHIP", ""))} · ${esc(h.source)}</div></div>
    </div>`).join("") + (list.length > 700 ? `<div class="muted">…refine search to see more</div>` : "");
}
$("#hull-list").onclick = (e) => { const it = e.target.closest(".item"); if (it) selectHull(it.dataset.id); };
["#hull-search", "#hull-source", "#hull-size"].forEach((s) => $(s).addEventListener("input", renderHullList));
try { const v = localStorage.getItem("forge.filter.hullsize"); if (v != null) $("#hull-size").value = v; if ($("#hull-size").selectedIndex < 0) $("#hull-size").value = "!FIGHTER"; } catch (e) { /* storage blocked */ }
$("#hull-size").addEventListener("change", () => { try { localStorage.setItem("forge.filter.hullsize", $("#hull-size").value); } catch (e) { /* ignore */ } });

// ================================================================ LOAD HULL / VARIANT
function isDirty(c = S.cur) {
  return !!c && (c.isNew || JSON.stringify(c.ship) !== c.shipOrig || JSON.stringify(c.variant) !== c.variantOrig || JSON.stringify(c.csv) !== c.csvOrig
    || (c.skin && JSON.stringify(c.skin) !== c.skinOrig) || JSON.stringify(c.desc) !== c.descOrig);
}
const anyDirty = () => S.tabs.some((t) => isDirty(t));
window.addEventListener("beforeunload", (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------- ship tabs
function tabName(c) { return (c.skin && c.skin.hullName) || c.ship.hullName || c.id; }
function renderTabs() {
  $("#ship-tabs").innerHTML = S.tabs.map((t, i) => `
    <div class="ship-tab${t === S.cur ? " active" : ""}" data-i="${i}" title="${esc(t.id)} · ${esc(t.file.source)}">
      ${isDirty(t) ? '<span class="dot">●</span>' : ""}<span class="nm">${esc(tabName(t))}</span>
      <button class="x" data-close="${i}" title="Close (middle-click also closes; right-click for Close others / Close all)">✕</button></div>`).join("") ||
    '<span class="muted" style="padding:4px 8px">Pick a hull on the left; each opens in its own tab.</span>';
}
/** Closes every tab for which keep(t, index) is false; edits stay in the Changes list. */
function closeTabs(close) {
  const cur = S.cur, gone = S.tabs.filter((t, i) => close(t, i));
  if (!gone.length) return;
  let kept = 0;
  for (const t of gone) { if (isDirty(t)) kept++; else delete S.shipDocs[t.id]; }
  S.tabs = S.tabs.filter((t) => !gone.includes(t));
  if (gone.includes(cur)) { S.cur = null; switchTab(S.tabs[S.tabs.length - 1] || null); } else renderTabs();
  toast(`Closed ${gone.length} tab${gone.length > 1 ? "s" : ""}.` + (kept ? ` Edits to ${kept} of them stay in the Changes list; reopen a hull to continue.` : ""));
}
function tabMenu(e, i) {
  e.preventDefault();
  document.querySelectorAll(".tab-menu").forEach((x) => x.remove());
  const m = document.createElement("div"); m.className = "tab-menu";
  const items = [["Close", () => closeTab(i)], ["Close others", () => closeTabs((t, k) => k !== i)],
    ["Close tabs to the right", () => closeTabs((t, k) => k > i)], ["Close all", () => closeTabs(() => true)]];
  m.innerHTML = items.map(([l], k) => `<button data-k="${k}"${(k === 1 && S.tabs.length < 2) || (k === 2 && i >= S.tabs.length - 1) ? " disabled" : ""}>${l}</button>`).join("");
  m.style.left = Math.min(e.clientX, window.innerWidth - 200) + "px"; m.style.top = e.clientY + "px";
  document.body.appendChild(m);
  m.onclick = (ev) => { const b = ev.target.closest("button[data-k]"); if (b && !b.disabled) { m.remove(); items[+b.dataset.k][1](); } };
  setTimeout(() => document.addEventListener("mousedown", function off(ev) { if (!ev.target.closest(".tab-menu")) { m.remove(); document.removeEventListener("mousedown", off, true); } }, true), 0);
}
$("#ship-tabs").addEventListener("contextmenu", (e) => { const t = e.target.closest(".ship-tab"); if (t) tabMenu(e, +t.dataset.i); });
$("#ship-tabs").addEventListener("mousedown", (e) => {
  if (e.button === 2) return; // right-click menu
  const x = e.target.closest("[data-close]"), t = e.target.closest(".ship-tab");
  if (x || (t && e.button === 1)) { e.preventDefault(); closeTab(+(x || t).dataset[x ? "close" : "i"]); return; }
  if (t) switchTab(S.tabs[+t.dataset.i]);
});
function switchTab(c) {
  if (S.cur && S.cur !== c) { S.cur.sel = S.sel; S.cur.view = { scale: V.scale, ox: V.ox, oy: V.oy }; }
  S.cur = c; S.sel = c ? c.sel : null;
  $("#hover-info").textContent = "";
  if (typeof renderAttachParent === "function") renderAttachParent();
  if (c && c.isSkin && ["bounds", "centers"].includes(S.mode)) S.mode = "view";
  document.querySelectorAll("#modes .mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === S.mode));
  $("#hint").textContent = HINTS[S.mode];
  document.querySelectorAll("#hull-list .item").forEach((x) => x.classList.toggle("selected", !!c && x.dataset.id === c.id));
  renderTabs();
  if (!c) { $("#ship-detail").innerHTML = '<p class="muted">Select a hull.</p>'; renderPop(); draw(); return; }
  if (c.view) { Object.assign(V, c.view); resizeCanvas(); } else fitView();
  renderDetail();
}
function closeTab(i) {
  const t = S.tabs[i];
  if (!t) return;
  // Edits stay in the Changes list; reopening the hull brings them back.
  if (isDirty(t)) toast(`${tabName(t)} closed. Its changes stay in the Changes list.`);
  else delete S.shipDocs[t.id];
  S.tabs.splice(i, 1);
  if (t === S.cur) { S.cur = null; switchTab(S.tabs[Math.min(i, S.tabs.length - 1)] || null); }
  else renderTabs();
}

async function selectHull(id, variantId) {
  const open = S.tabs.find((t) => t.id === id) || S.shipDocs[id];
  if (open) {
    if (!S.tabs.includes(open)) S.tabs.push(open);
    switchTab(open);
    const want = variantId && open.variants.find((v) => v.variantId === variantId);
    if (want && (!open.variantFile || open.variantFile.variantId !== variantId)) await loadVariant(want);
    return;
  }
  const data = await api("/api/hull?id=" + encodeURIComponent(id));
  if (!data) return;
  const descId = data.skin ? data.skin.descriptionId || data.skin.baseHullId : id;
  const desc = await api(`/api/description?type=SHIP&id=${encodeURIComponent(descId)}`).catch(() => null);
  const c = makeShipDoc({ id, data, desc: data.skin ? null : desc, baseDesc: data.skin ? desc : null });
  c.variants = (await api("/api/variants?hull=" + encodeURIComponent(id))).sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)));
  const prev = S.cur;
  S.cur = c;
  if (c.variants.length) await loadVariant(c.variants.find((v) => v.variantId === variantId) || c.variants[0]);
  else newVariant();
  S.cur = prev;
  switchTab(c);
}

/** Builds and registers an editor document for a hull or skin. Skins are edited as base hull + overrides. */
function makeShipDoc({ id, data, desc, baseDesc, isNew, spriteUpload }) {
  const isSkin = !!data.skin;
  const base = clone(data.ship || data.baseShip || {});
  for (const k of ["weaponSlots", "engineSlots", "bounds", "builtInMods"]) if (!Array.isArray(base[k])) base[k] = base[k] || [];
  if (!base.center) base.center = [Math.round((base.width || 100) / 2), Math.round((base.height || 100) / 2)];
  const skin = isSkin ? clone(data.skin) : null;
  const ship = isSkin ? applySkin(base, skin) : base;
  const c = {
    id, data, isSkin, ship, shipOrig: JSON.stringify(ship), base: isSkin ? clone(base) : null,
    skin, skinOrig: skin ? JSON.stringify(skin) : null,
    file: Object.assign({}, data.file || { path: null, source: null }), baseFile: data.baseFile || null,
    csv: clone(data.csv || {}), csvOrig: JSON.stringify(data.csv || {}), img: null, weaponImgs: {},
    desc: desc ? clone(desc) : null, descOrig: JSON.stringify(desc || null), baseDesc,
    variant: null, variantOrig: "null", variantFile: null, variants: [], isNew: !!isNew, spriteUpload: spriteUpload || null,
    undo: [], redo: [], sel: null, view: null, uid: newUid("ship"),
  };
  S.tabs.push(c); S.shipDocs[id] = c;
  loadShipSprite(c);
  return c;
}
function spriteOf(c) { return (c.skin && c.skin.spriteName) || c.ship.spriteName; }
function loadShipSprite(c) {
  const src = c.spriteUpload && c.spriteUpload.rel === spriteOf(c) ? c.spriteUpload.dataUrl : asset(spriteOf(c));
  c.sprite = spriteOf(c); c.imgError = false;
  if (!c.sprite) { c.img = null; return; }
  const img = new Image();
  img.onload = () => { c.img = img; c.view = null; if (S.cur === c) { fitView(); renderDetail(); } };
  img.onerror = () => { c.img = null; c.imgError = true; if (S.cur === c) { draw(); renderDetail(); } };
  img.src = src;
}

// ---------------------------------------------------------------- skins: base hull + overrides
function applySkin(base, skin) {
  const s = clone(base);
  const rm = new Set(skin.removeWeaponSlots || []);
  s.weaponSlots = s.weaponSlots.filter((w) => !rm.has(w.id));
  for (const [sid, ch] of Object.entries(skin.weaponSlotChanges || {})) { const w = s.weaponSlots.find((x) => x.id === sid); if (w) Object.assign(w, clone(ch)); }
  s.engineSlots = s.engineSlots.map((e, i) => Object.assign(e, { _bi: i }));
  const rmE = new Set((skin.removeEngineSlots || []).map(Number));
  s.engineSlots = s.engineSlots.filter((e) => !rmE.has(e._bi));
  for (const [ix, ch] of Object.entries(skin.engineSlotChanges || {})) { const e = s.engineSlots.find((x) => x._bi === +ix); if (e) Object.assign(e, clone(ch)); }
  const rmM = new Set(skin.removeBuiltInMods || []);
  s.builtInMods = (s.builtInMods || []).filter((m) => !rmM.has(m)).concat((skin.builtInMods || []).filter((m) => !(s.builtInMods || []).includes(m)));
  const bw = Object.assign({}, s.builtInWeapons || {});
  for (const k of skin.removeBuiltInWeapons || []) delete bw[k];
  s.builtInWeapons = Object.assign(bw, skin.builtInWeapons || {});
  if (Array.isArray(skin.builtInWings)) s.builtInWings = skin.builtInWings.slice();
  if (skin.hullName) s.hullName = skin.hullName;
  return s;
}
/** Re-derives the .skin overrides from the edited (effective) hull compared with the base hull. */
function buildSkin(c) {
  const out = clone(c.skin), base = c.base, cur = c.ship;
  const keep = (k, v, empty) => { if (!empty || k in c.skin) out[k] = v; else delete out[k]; };
  const curIds = new Set(cur.weaponSlots.map((w) => w.id));
  const removed = base.weaponSlots.filter((w) => !curIds.has(w.id)).map((w) => w.id);
  keep("removeWeaponSlots", removed, !removed.length);
  const changes = {};
  for (const w of cur.weaponSlots) {
    const b = base.weaponSlots.find((x) => x.id === w.id);
    if (!b) continue;
    const ch = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(w)])) if (k !== "id" && JSON.stringify(b[k]) !== JSON.stringify(w[k])) ch[k] = clone(w[k]);
    if (Object.keys(ch).length) changes[w.id] = ch;
  }
  keep("weaponSlotChanges", changes, !Object.keys(changes).length);
  const curBi = new Set(cur.engineSlots.map((e) => e._bi));
  const rmE = base.engineSlots.map((e, i) => i).filter((i) => !curBi.has(i));
  keep("removeEngineSlots", rmE, !rmE.length);
  const ech = {};
  for (const e of cur.engineSlots) {
    const b = base.engineSlots[e._bi]; if (!b) continue;
    const ch = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(e)])) if (k !== "_bi" && JSON.stringify(b[k]) !== JSON.stringify(e[k])) ch[k] = clone(e[k]);
    if (Object.keys(ch).length) ech[e._bi] = ch;
  }
  keep("engineSlotChanges", ech, !Object.keys(ech).length);
  const bm = base.builtInMods || [], cm = cur.builtInMods || [];
  const addM = cm.filter((m) => !bm.includes(m)), rmM = bm.filter((m) => !cm.includes(m));
  keep("builtInMods", addM, !addM.length); keep("removeBuiltInMods", rmM, !rmM.length);
  const bw = base.builtInWeapons || {}, cw = cur.builtInWeapons || {};
  const addW = Object.fromEntries(Object.entries(cw).filter(([k, v]) => bw[k] !== v)), rmW = Object.keys(bw).filter((k) => !(k in cw));
  keep("builtInWeapons", addW, !Object.keys(addW).length); keep("removeBuiltInWeapons", rmW, !rmW.length);
  if (JSON.stringify(cur.builtInWings || []) !== JSON.stringify(base.builtInWings || [])) out.builtInWings = (cur.builtInWings || []).slice();
  else if (!("builtInWings" in c.skin)) delete out.builtInWings;
  return out;
}

async function loadVariant(entry) {
  const c = S.cur;
  if (isVariantDirty() && !confirm("Switching variants discards your unsaved changes to this variant (they'll leave the Changes list). Continue?")) { renderDetail(); return; }
  const v = await api("/api/file?path=" + encodeURIComponent(entry.path));
  normalizeVariant(v);
  c.variant = v; c.variantOrig = JSON.stringify(v); c.variantFile = Object.assign({}, entry);
  loadWeaponImages(); draw(); renderDetail(); scheduleSync();
}
const isVariantDirty = () => S.cur && JSON.stringify(S.cur.variant) !== S.cur.variantOrig;

function normalizeVariant(v) {
  for (const k of ["hullMods", "permaMods", "sMods", "wings", "weaponGroups"]) if (!Array.isArray(v[k])) v[k] = [];
  v.fluxVents = v.fluxVents || 0; v.fluxCapacitors = v.fluxCapacitors || 0;
  if (v.modules && !Array.isArray(v.modules)) v.modules = Object.entries(v.modules).map(([k, x]) => ({ [k]: x }));
  return v;
}

function newVariant() {
  const c = S.cur;
  c.variant = normalizeVariant({ displayName: "Custom", hullId: c.id, variantId: c.id + "_custom", fluxVents: 0, fluxCapacitors: 0 });
  c.variantOrig = JSON.stringify(c.variant); c.variantFile = null; // not "unsaved" until actually edited
  draw(); renderDetail(); scheduleSync();
}

// ================================================================ UNDO / REDO
const snapshot = () => JSON.stringify({ ship: S.cur.ship, variant: S.cur.variant, skin: S.cur.skin, csv: S.cur.csv, desc: S.cur.desc });
function pushUndo() { const c = S.cur; if (!c) return; c.undo.push(snapshot()); if (c.undo.length > 200) c.undo.shift(); c.redo = []; }
function restore(snap) {
  const o = JSON.parse(snap), c = S.cur, spriteBefore = spriteOf(c);
  c.ship = o.ship; c.variant = o.variant; if (o.skin) c.skin = o.skin; if (o.csv) c.csv = o.csv; if ("desc" in o) c.desc = o.desc;
  S.sel = null; if (spriteOf(c) !== spriteBefore) loadShipSprite(c);
  loadWeaponImages(); draw(); renderDetail(); scheduleSync();
}
function undo() { const c = S.cur; if (c && c.undo.length) { c.redo.push(snapshot()); restore(c.undo.pop()); } }
function redo() { const c = S.cur; if (c && c.redo.length) { c.undo.push(snapshot()); restore(c.redo.pop()); } }
$("#undo").onclick = undo; $("#redo").onclick = redo;
/** Wraps a discrete edit: snapshot, apply, redraw. */
function edit(fn, rerender = true) { pushUndo(); fn(); loadWeaponImages(); draw(); if (rerender) renderDetail(); scheduleSync(); }

// ================================================================ CANVAS
const cv = $("#view"), ctx = cv.getContext("2d");
const V = { scale: 1, ox: 0, oy: 0, drag: null };

function resizeCanvas() {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  placeHint();
  $("#hover-info").style.bottom = "8px";
  draw();
}
window.addEventListener("resize", resizeCanvas);

function placeHint() {
  const m = $("#modes");
  $("#hint").style.top = m.offsetTop + m.offsetHeight + 6 + "px";
}
new ResizeObserver(placeHint).observe($("#modes"));
new ResizeObserver(placeHint).observe($("#ship-tabs"));
function dims() {
  const c = S.cur, img = c && c.img;
  return { W: (img && img.naturalWidth) || c.ship.width || 100, H: (img && img.naturalHeight) || c.ship.height || 100 };
}
function fitView() {
  if (!S.cur) return;
  resizeCanvas();
  const r = cv.getBoundingClientRect(), { W, H } = dims();
  // fit the hull plus any attached parts (modules, or the parent around a module) that are shown
  let [x0, y0, x1, y1] = [0, 0, W, H];
  if (typeof attachedBox === "function") { const b = attachedBox(); if (b) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); } }
  const bw = x1 - x0, bh = y1 - y0;
  V.scale = Math.min(r.width / bw, r.height / bh) * 0.8;
  V.ox = (r.width - bw * V.scale) / 2 - x0 * V.scale; V.oy = (r.height - bh * V.scale) / 2 - y0 * V.scale;
  draw();
}
// Ship coordinates: [forward, left] relative to "center"; "center" is in sprite pixels from the bottom-left.
function toScreen(fwd, left) {
  const c = S.cur.ship.center, { H } = dims();
  return [V.ox + (c[0] - left) * V.scale, V.oy + (H - c[1] - fwd) * V.scale];
}
function fromScreen(sx, sy) {
  const c = S.cur.ship.center, { H } = dims();
  return [H - c[1] - (sy - V.oy) / V.scale, c[0] - (sx - V.ox) / V.scale];
}
const snapV = (v) => ($("#snap").checked ? Math.round(v * 2) / 2 : r2(v));
const dirOf = (deg) => { const a = (deg * Math.PI) / 180; return [-Math.sin(a), -Math.cos(a)]; };
const angleTo = (from, to) => { const a = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI; return snapV(a); };
const loc = (s) => (Array.isArray(s.locations) ? s.locations : s.location || [0, 0]);
const rgba = (c, a) => (Array.isArray(c) ? `rgba(${c[0]},${c[1]},${c[2]},${a ?? (c[3] ?? 255) / 255})` : null);

const flameCache = {};
function tintedFlame(color) {
  const key = color.join(",");
  if (flameCache[key] || !FLAME.complete || !FLAME.naturalWidth) return flameCache[key];
  const c = document.createElement("canvas"); c.width = FLAME.naturalWidth; c.height = FLAME.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(FLAME, 0, 0); g.globalCompositeOperation = "source-in";
  g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`; g.fillRect(0, 0, c.width, c.height);
  return (flameCache[key] = c);
}
function engineStyleSpec(e) {
  if (e.style === "CUSTOM") return e.styleSpec || S.styles.engine[e.styleId] || null;
  return S.styles.engine[e.style] || null;
}
function engineColor(e) {
  const spec = engineStyleSpec(e);
  return spec && Array.isArray(spec.engineColor) ? spec.engineColor : ENGINE_DEFAULT_COLOR;
}

function slotWeapons() {
  const out = {}, c = S.cur;
  const bi = c.ship.builtInWeapons || {};
  for (const k in bi) out[k] = bi[k];
  for (const g of (c.variant && c.variant.weaponGroups) || []) for (const k in g.weapons || {}) out[k] = g.weapons[k];
  return out;
}
function loadWeaponImages() {
  const c = S.cur; if (!c) return;
  const slots = Object.fromEntries((c.ship.weaponSlots || []).map((s) => [s.id, s]));
  for (const [slotId, wid] of Object.entries(slotWeapons())) {
    const w = S.weapons[wid], slot = slots[slotId];
    if (!w || !slot) continue;
    const path = slot.mount === "HARDPOINT" ? w._hardpointSprite || w._turretSprite : w._turretSprite || w._hardpointSprite;
    const key = wid + "|" + slot.mount;
    if (!path || c.weaponImgs[key]) continue;
    c.weaponImgs[key] = "loading";
    const img = new Image();
    img.onload = () => { c.weaponImgs[key] = img; draw(); };
    img.src = asset(path);
  }
}

function drawChecker(x, y, w, h) {
  const sz = 8;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = THEME.checkerA; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = THEME.checkerB;
  for (let yy = 0; yy < h; yy += sz) for (let xx = ((yy / sz) % 2) * sz; xx < w; xx += sz * 2) ctx.fillRect(x + xx, y + yy, sz, sz);
  ctx.restore();
}

function draw() {
  const r = cv.getBoundingClientRect();
  ctx.fillStyle = THEME.background; ctx.fillRect(0, 0, r.width, r.height);
  const c = S.cur;
  positionPop();
  if (!c) return;
  const { W, H } = dims(), sh = c.ship, m = S.mode, on = (id) => $("#" + id).checked;
  if (on("show-checker")) drawChecker(V.ox, V.oy, W * V.scale, H * V.scale);
  if (typeof loadParentRef === "function") loadParentRef(c);
  drawModules(true);
  if (c.img) { ctx.imageSmoothingEnabled = V.scale < 2; ctx.drawImage(c.img, V.ox, V.oy, W * V.scale, H * V.scale); }
  drawModules(false);

  // mirror axis (ship's centerline)
  if ($("#mirror").checked && ["slots", "engines", "bounds"].includes(m)) {
    const [x] = toScreen(0, 0);
    ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = hexA(THEME.mirror, 0.25); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke(); ctx.restore();
  }

  // shield (hull style colours) and collision radius
  if ((on("show-shield") || m === "centers") && sh.shieldCenter) {
    const hs = S.styles.hull[sh.style] || {};
    const [x, y] = toScreen(sh.shieldCenter[0], sh.shieldCenter[1]), rad = (sh.shieldRadius || 0) * V.scale;
    ctx.fillStyle = rgba(hs.shieldInnerColor, 0.18) || "#4fc3e822"; ctx.strokeStyle = rgba(hs.shieldRingColor, 0.9) || "#4fc3e8";
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (m === "centers" && sh.collisionRadius) {
    const [x, y] = toScreen(0, 0);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = hexA(THEME.collision, 0.6); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, sh.collisionRadius * V.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }

  // engines: flame textures tinted by engine style (as in Ontheheavens' Ship-Editor)
  sh.engineSlots.forEach((e, i) => {
    const [x, y] = toScreen(loc(e)[0], loc(e)[1]), [dx, dy] = dirOf(e.angle ?? 180);
    const len = (e.length || 0) * V.scale, wid = (e.width || 0) * V.scale, col = engineColor(e);
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx));
    if (m === "engines") {
      ctx.fillStyle = "#0000001a"; ctx.fillRect(0, -wid / 2, len, wid);
      ctx.strokeStyle = S.sel && S.sel.kind === "engine" && S.sel.i === i ? THEME.select : "#000000aa";
      ctx.lineWidth = 1; ctx.strokeRect(0, -wid / 2, len, wid);
    }
    const fl = tintedFlame(col);
    if (fl && (col[3] ?? 255) > 0 && len > 0 && wid > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fl, 0, -wid / 2, len, wid);
      if (FLAME_CORE.complete) ctx.drawImage(FLAME_CORE, 0, -wid / 2, len, wid);
    }
    ctx.restore();
    if (m === "engines") drawHandle(x, y, S.sel && S.sel.kind === "engine" && S.sel.i === i, THEME.engineHandle, e.angle ?? 180);
  });

  // weapon slots and fitted weapons
  const sw = slotWeapons();
  sh.weaponSlots.forEach((s, i) => {
    const [x, y] = toScreen(loc(s)[0], loc(s)[1]), col = slotColor(s.type);
    const selected = S.sel && S.sel.kind === "slot" && S.sel.i === i;
    if (on("show-weapons") && sw[s.id]) {
      const img = c.weaponImgs[sw[s.id] + "|" + s.mount];
      if (img && img !== "loading") {
        ctx.save(); ctx.translate(x, y); ctx.rotate((-(s.angle || 0) * Math.PI) / 180);
        ctx.imageSmoothingEnabled = V.scale < 2;
        // Turrets are centred on the slot; hardpoints sit with the slot 75% of the way down the sprite.
        const ay = s.mount === "HARDPOINT" ? 0.75 : 0.5;
        ctx.drawImage(img, (-img.naturalWidth * V.scale) / 2, -img.naturalHeight * ay * V.scale, img.naturalWidth * V.scale, img.naturalHeight * V.scale);
        ctx.restore();
      }
    }
    if ((on("show-arcs") || selected || m === "slots") && s.arc && s.type !== "LAUNCH_BAY" && s.mount !== "HIDDEN") {
      const rad = (12 + 6 * SIZES.indexOf(s.size)) * Math.min(4, Math.max(1, V.scale));
      const ac = THEME.arcMode === "custom" ? THEME.arcColor : col, op = THEME.arcOpacity / 100;
      ctx.fillStyle = hexA(ac, Math.min(1, op * (selected ? 1.6 : 1))); ctx.strokeStyle = hexA(ac, Math.min(1, op * 3 + (selected ? 0.3 : 0))); ctx.lineWidth = selected ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let a = (s.angle || 0) - s.arc / 2; a <= (s.angle || 0) + s.arc / 2 + 0.01; a += Math.max(1, s.arc / 40)) { const [dx, dy] = dirOf(a); ctx.lineTo(x + dx * rad, y + dy * rad); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (m !== "view" || !sw[s.id]) {
      const sz = (2 + 1.5 * Math.max(0, SIZES.indexOf(s.size))) * Math.min(4, Math.max(1, V.scale));
      ctx.strokeStyle = selected ? THEME.select : col; ctx.lineWidth = selected ? 3 : 1.5; ctx.beginPath();
      if (s.mount === "HARDPOINT") ctx.rect(x - sz, y - sz, sz * 2, sz * 2); else ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.stroke();
      const [dx, dy] = dirOf(s.angle || 0); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * (sz + 6), y + dy * (sz + 6)); ctx.stroke();
    }
  });

  // launch bays: every launch point
  sh.weaponSlots.forEach((s, i) => {
    if (s.type !== "LAUNCH_BAY") return;
    const l = loc(s); if (l.length < 4 && m !== "slots") return;
    ctx.strokeStyle = slotColor(s.type); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k + 1 < l.length; k += 2) { const [x, y] = toScreen(l[k], l[k + 1]); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
    for (let k = 0; k + 1 < l.length; k += 2) {
      const [x, y] = toScreen(l[k], l[k + 1]), sel = S.sel && S.sel.kind === "slot" && S.sel.i === i && (S.sel.p || 0) === k / 2;
      ctx.fillStyle = sel ? THEME.select : slotColor(s.type); ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
    }
  });

  // centers
  const cross = (x, y, col, s) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke(); };
  { const [x, y] = toScreen(0, 0); cross(x, y, THEME.center, m === "centers" ? 10 : 5); }
  if (m === "centers" && sh.shieldCenter) { const [x, y] = toScreen(sh.shieldCenter[0], sh.shieldCenter[1]); cross(x, y, THEME.shieldCenter, 8); }
  if (Array.isArray(sh.moduleAnchor) && (m === "centers" || m === "view")) { const [x, y] = toScreen(sh.moduleAnchor[0], sh.moduleAnchor[1]); cross(x, y, "#ffb15c", m === "centers" ? 9 : 5); }

  // bounds: drawn on top of everything (sprite, weapons, modules, slots) so the line and points stay visible
  const b = sh.bounds;
  if (b.length >= 4) {
    const trace = () => { ctx.beginPath(); for (let i = 0; i < b.length; i += 2) { const [x, y] = toScreen(b[i], b[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); };
    if (m === "bounds") { trace(); ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 4; ctx.stroke(); } // dark outline for bright sprites
    trace(); ctx.strokeStyle = m === "bounds" ? THEME.bounds : hexA(THEME.bounds, 0.6); ctx.lineWidth = m === "bounds" ? 2 : 1.25; ctx.stroke();
    if (m === "bounds") for (let i = 0; i < b.length; i += 2) {
      const [x, y] = toScreen(b[i], b[i + 1]), s = S.sel && S.sel.kind === "bound" && S.sel.i === i / 2;
      ctx.fillStyle = "#000"; ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = s ? THEME.select : THEME.bounds; ctx.fillRect(x - 4, y - 4, 8, 8);
      if (s) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x - 6, y - 6, 12, 12); }
    }
  }

  // label + ring on the selected slot/engine so it's obvious what the popup edits
  const so = S.sel && (S.sel.kind === "slot" ? sh.weaponSlots[S.sel.i] : S.sel.kind === "engine" ? sh.engineSlots[S.sel.i] : null);
  if (so) {
    const sp = S.sel.kind === "slot" ? (S.sel.p || 0) * 2 : 0;
    const [x, y] = toScreen(loc(so)[sp] ?? loc(so)[0], loc(so)[sp + 1] ?? loc(so)[1]);
    ctx.strokeStyle = THEME.select; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const label = S.sel.kind === "slot" ? so.id : "Engine " + (S.sel.i + 1);
    ctx.font = "bold 12px Segoe UI, sans-serif"; ctx.lineWidth = 3; ctx.strokeStyle = "#000";
    ctx.strokeText(label, x + 19, y - 10); ctx.fillStyle = THEME.labels; ctx.fillText(label, x + 19, y - 10);
  }
}

function drawHandle(x, y, selected, col, angle) {
  ctx.fillStyle = selected ? THEME.select : col; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, selected ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const [dx, dy] = dirOf(angle); ctx.strokeStyle = selected ? THEME.select : col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * 16, y + dy * 16); ctx.stroke();
}
document.querySelectorAll("#modes input").forEach((i) => (i.onchange = draw));

// ================================================================ MODES & INTERACTION
function setMode(m) {
  if (S.cur && S.cur.isSkin && ["bounds", "centers"].includes(m)) {
    toast("Skins can't change bounds or centers: those come from the base hull. Slots and engines can be changed or removed here.", true);
    return;
  }
  S.mode = m; S.sel = null;
  document.querySelectorAll("#modes .mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("#hint").textContent = HINTS[m];
  draw(); renderDetail();
}
document.querySelectorAll("#modes .mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$("#hint").textContent = HINTS.view;

function mouseShip(e) { const r = cv.getBoundingClientRect(); return fromScreen(e.clientX - r.left, e.clientY - r.top); }
function hitPoint(e, pts, radius = 10) {
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = -1, bd = radius;
  pts.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]), d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = i; } });
  return best;
}
const boundPts = () => { const b = S.cur.ship.bounds, o = []; for (let i = 0; i < b.length; i += 2) o.push([b[i], b[i + 1]]); return o; };

/** Index of the mirror twin (same forward, opposite left), or -1. */
function twin(pts, i) {
  const p = pts[i];
  if (!p || Math.abs(p[1]) < 0.01) return -1;
  return pts.findIndex((q, j) => j !== i && Math.abs(q[0] - p[0]) < 0.6 && Math.abs(q[1] + p[1]) < 0.6);
}
const mirrorOn = () => $("#mirror").checked;

cv.addEventListener("mousedown", (e) => {
  cv.focus();
  if (!S.cur) return;
  const m = S.mode, sh = S.cur.ship, p = mouseShip(e);
  const startPan = () => (V.drag = { pan: [e.clientX, e.clientY, V.ox, V.oy] });

  if (m === "variant") {
    const i = hitPoint(e, sh.weaponSlots.map(loc), 12);
    if (i >= 0) {
      const again = S.sel && S.sel.kind === "slot" && S.sel.i === i;
      S.sel = { kind: "slot", i }; draw(); renderDetail();
      if (again && sh.weaponSlots[i].type === "STATION_MODULE") openModulePicker(sh.weaponSlots[i]);
      else if (again && sh.weaponSlots[i].type !== "LAUNCH_BAY") openWeaponPicker(sh.weaponSlots[i]);
    } else { if (S.sel) { S.sel = null; draw(); renderDetail(); } startPan(); }
    return;
  }
  if (m === "slots" || m === "engines") {
    const list = m === "slots" ? sh.weaponSlots : sh.engineSlots, kind = m === "slots" ? "slot" : "engine";
    const sp = m === "slots" ? slotPoints() : list.map((x, i) => ({ i, p: 0, pt: loc(x) }));
    const hit = hitPoint(e, sp.map((x) => x.pt)), i = hit >= 0 ? sp[hit].i : -1, pIdx = hit >= 0 ? sp[hit].p : 0;
    if (i >= 0) {
      S.sel = { kind, i, p: pIdx };
      const op = e.altKey ? "aim" : e.ctrlKey && kind === "engine" ? "size" : "move";
      V.drag = { op, kind, i, p: pIdx, twin: mirrorOn() ? twin(list.map(loc), i) : -1, started: false };
      draw(); renderDetail();
    } else if (e.shiftKey) {
      edit(() => addPoint(kind, [snapV(p[0]), snapV(p[1])]));
    } else { S.sel = null; draw(); renderDetail(); startPan(); }
    return;
  }
  if (m === "bounds") {
    const pts = boundPts(), i = hitPoint(e, pts);
    if (i >= 0) {
      S.sel = { kind: "bound", i };
      V.drag = { op: "move", kind: "bound", i, twin: mirrorOn() ? twin(pts, i) : -1, started: false };
      draw(); renderDetail();
    } else if (e.shiftKey) {
      edit(() => insertBound([snapV(p[0]), snapV(p[1])]));
    } else { S.sel = null; draw(); renderDetail(); startPan(); }
    return;
  }
  if (m === "centers") {
    if (e.altKey && sh.shieldCenter) { V.drag = { op: "shieldRadius", started: false }; return; }
    if (e.shiftKey) { V.drag = { op: "collisionRadius", started: false }; return; }
    const handles = [[0, 0], sh.shieldCenter || [9e9, 9e9], Array.isArray(sh.moduleAnchor) ? sh.moduleAnchor : [9e9, 9e9]];
    const i = hitPoint(e, handles, 14);
    if (i === 0) { V.drag = { op: "center", started: false, last: p }; return; }
    if (i === 1) { V.drag = { op: "shieldCenter", started: false }; return; }
    if (i === 2) { V.drag = { op: "moduleAnchor", started: false }; return; }
    startPan(); return;
  }
  startPan();
});

window.addEventListener("mouseup", () => { if (V.drag && V.drag.started) { renderDetail(); scheduleSync(); } V.drag = null; positionPop(); });
cv.addEventListener("dblclick", fitView);
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  V.ox = mx - (mx - V.ox) * f; V.oy = my - (my - V.oy) * f; V.scale *= f; draw();
}, { passive: false });

cv.addEventListener("mousemove", (e) => {
  const d = V.drag;
  if (d && d.pan) { V.ox = d.pan[2] + e.clientX - d.pan[0]; V.oy = d.pan[3] + e.clientY - d.pan[1]; draw(); return; }
  if (!S.cur) return;
  const p = mouseShip(e), sp = [snapV(p[0]), snapV(p[1])], sh = S.cur.ship;
  if (d) {
    if (!d.started) { pushUndo(); d.started = true; }
    if (d.kind === "slot" || d.kind === "engine") {
      const list = d.kind === "slot" ? sh.weaponSlots : sh.engineSlots, it = list[d.i], tw = d.twin >= 0 ? list[d.twin] : null;
      const at = loc(it);
      if (d.op === "move") {
        setLocAt(it, d.p || 0, sp);
        if (tw && loc(tw).length > (d.p || 0) * 2) setLocAt(tw, d.p || 0, [sp[0], -sp[1]]);
      }
      else if (d.op === "aim") { it.angle = angleTo(at, sp); if (tw) tw.angle = -it.angle; }
      else if (d.op === "size") {
        const a = ((it.angle ?? 180) * Math.PI) / 180, rel = [sp[0] - at[0], sp[1] - at[1]];
        const along = rel[0] * Math.cos(a) + rel[1] * Math.sin(a), perp = -rel[0] * Math.sin(a) + rel[1] * Math.cos(a);
        it.length = Math.max(0.5, snapV(Math.abs(along))); it.width = Math.max(0.5, snapV(Math.abs(perp) * 2));
        if (tw) { tw.length = it.length; tw.width = it.width; }
      }
    } else if (d.kind === "bound") {
      sh.bounds[d.i * 2] = sp[0]; sh.bounds[d.i * 2 + 1] = sp[1];
      if (d.twin >= 0) { sh.bounds[d.twin * 2] = sp[0]; sh.bounds[d.twin * 2 + 1] = -sp[1]; }
    } else if (d.op === "shieldCenter") sh.shieldCenter = sp;
    else if (d.op === "moduleAnchor") sh.moduleAnchor = sp;
    else if (d.op === "shieldRadius") sh.shieldRadius = snapV(Math.hypot(p[0] - sh.shieldCenter[0], p[1] - sh.shieldCenter[1]));
    else if (d.op === "collisionRadius") sh.collisionRadius = snapV(Math.hypot(p[0], p[1]));
    else if (d.op === "center") moveCenterTo(sp);
    draw(); updateLiveFields();
    return;
  }
  // hover info
  const sw = slotWeapons();
  const i = hitPoint(e, sh.weaponSlots.map(loc), 12);
  const s = sh.weaponSlots[i];
  $("#hover-info").textContent = (s
    ? `${s.id} · ${s.size} ${s.type} ${s.mount} · arc ${s.arc}° · angle ${s.angle}°${sw[s.id] ? " · " + ((S.weapons[sw[s.id]] || {}).name || sw[s.id]) : ""}  ·  `
    : "") + `x ${r2(p[0])}, y ${r2(p[1])}`;
});

/** Every grabbable slot point: one per slot, or one per launch point for launch bays. */
function slotPoints() {
  const out = [];
  S.cur.ship.weaponSlots.forEach((s, i) => {
    const l = loc(s), n = s.type === "LAUNCH_BAY" ? Math.max(1, Math.floor(l.length / 2)) : 1;
    for (let p = 0; p < n; p++) out.push({ i, p, pt: [l[p * 2], l[p * 2 + 1]] });
  });
  return out;
}
function setLocAt(it, p, xy) {
  if (Array.isArray(it.locations)) { it.locations[p * 2] = xy[0]; it.locations[p * 2 + 1] = xy[1]; } else it.location = [xy[0], xy[1]];
}
function setLoc(it, p) { if (Array.isArray(it.locations)) { it.locations[0] = p[0]; it.locations[1] = p[1]; } else it.location = [p[0], p[1]]; }

/** Moving the ship center keeps every point in place on the sprite (all coordinates are center-relative). */
function moveCenterTo(sp) {
  const sh = S.cur.ship;
  const df = sp[0], dl = sp[1];
  if (!df && !dl) return;
  const shift = (a, k = 0) => { a[k] = r2(a[k] - df); a[k + 1] = r2(a[k + 1] - dl); };
  sh.center = [r2(sh.center[0] - dl), r2(sh.center[1] + df)];
  for (const s of sh.weaponSlots) { const l = loc(s); for (let k = 0; k + 1 < l.length; k += 2) shift(l, k); }
  for (const e of sh.engineSlots) shift(loc(e));
  for (let k = 0; k + 1 < sh.bounds.length; k += 2) shift(sh.bounds, k);
  if (sh.shieldCenter) shift(sh.shieldCenter);
  if (Array.isArray(sh.moduleAnchor)) shift(sh.moduleAnchor);
}

function nextSlotId() {
  let n = 0;
  for (const s of S.cur.ship.weaponSlots) { const m = /(\d+)\s*$/.exec(s.id || ""); if (m) n = Math.max(n, +m[1]); }
  return "WS " + String(n + 1).padStart(3, "0");
}
function addPoint(kind, p) {
  if (S.cur.isSkin) { toast("Skins can only change or remove the base hull's slots and engines, not add new ones.", true); return; }
  const sh = S.cur.ship, pair = mirrorOn() && Math.abs(p[1]) >= 0.5;
  if (kind === "slot") {
    const base = S.sel && S.sel.kind === "slot" ? sh.weaponSlots[S.sel.i] : null;
    const mk = (pt, ang) => ({ angle: ang, arc: base ? base.arc : 180, id: nextSlotId(), locations: pt, mount: base ? base.mount : "TURRET", size: base ? base.size : "SMALL", type: base ? base.type : "BALLISTIC" });
    sh.weaponSlots.push(mk(p, 0));
    S.sel = { kind, i: sh.weaponSlots.length - 1 };
    if (pair) sh.weaponSlots.push(mk([p[0], -p[1]], 0));
  } else {
    const base = S.sel && S.sel.kind === "engine" ? sh.engineSlots[S.sel.i] : sh.engineSlots[0];
    const mk = (pt) => Object.assign({}, base ? clone(base) : { angle: 180, contrailSize: 20, length: 20, width: 8, style: sh.style || "LOW_TECH" }, { location: pt });
    sh.engineSlots.push(mk(p));
    S.sel = { kind, i: sh.engineSlots.length - 1 };
    if (pair) { const t = mk([p[0], -p[1]]); t.angle = -(t.angle ?? 180); sh.engineSlots.push(t); }
  }
}
function insertBound(p) {
  const b = S.cur.ship.bounds, pts = boundPts();
  if (pts.length < 3) { b.push(p[0], p[1]); S.sel = { kind: "bound", i: pts.length }; return; }
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / ((c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 || 1)));
    const d = Math.hypot(p[0] - (a[0] + t * (c[0] - a[0])), p[1] - (a[1] + t * (c[1] - a[1])));
    if (d < bd) { bd = d; best = i; }
  }
  b.splice((best + 1) * 2, 0, p[0], p[1]);
  S.sel = { kind: "bound", i: best + 1 };
}
function deleteSelected() {
  const sel = S.sel, sh = S.cur && S.cur.ship;
  if (!sel || !sh) return;
  edit(() => {
    if (sel.kind === "slot") {
      const tw = mirrorOn() ? twin(sh.weaponSlots.map(loc), sel.i) : -1;
      for (const i of [sel.i, tw].filter((x) => x >= 0).sort((a, b) => b - a)) {
        const id = sh.weaponSlots[i].id;
        sh.weaponSlots.splice(i, 1);
        if (sh.builtInWeapons) delete sh.builtInWeapons[id];
        for (const g of (S.cur.variant && S.cur.variant.weaponGroups) || []) delete (g.weapons || {})[id];
      }
    } else if (sel.kind === "engine") {
      const tw = mirrorOn() ? twin(sh.engineSlots.map(loc), sel.i) : -1;
      for (const i of [sel.i, tw].filter((x) => x >= 0).sort((a, b) => b - a)) sh.engineSlots.splice(i, 1);
    } else if (sel.kind === "bound") {
      const tw = mirrorOn() ? twin(boundPts(), sel.i) : -1;
      for (const i of [sel.i, tw].filter((x) => x >= 0).sort((a, b) => b - a)) sh.bounds.splice(i * 2, 2);
    }
    S.sel = null;
  });
}

document.addEventListener("keydown", (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveAll(); return; }
  if (e.key === "Escape" && $("#picker").classList.contains("hidden") && S.sel) { S.sel = null; draw(); renderDetail(); return; }
  if (typing || !$("#picker").classList.contains("hidden")) { if (e.key === "Escape") closePicker(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
  else if (e.key === "Delete" || e.key === "Backspace") { if (S.sel && S.mode !== "variant") { e.preventDefault(); deleteSelected(); } }
  else if (e.key.toLowerCase() === "m") { $("#mirror").checked = !$("#mirror").checked; draw(); }
  else if ("123456".includes(e.key) && $("#tab-ships").classList.contains("active")) setMode(["view", "variant", "slots", "engines", "bounds", "centers"][+e.key - 1]);
});

// ================================================================ DETAIL PANEL
function header() {
  const c = S.cur;
  const issues = checkShip(c), errs = issues.filter((x) => x.level === "error").length, warns = issues.length - errs;
  return `<h2>${esc(tabName(c))}${c.isNew ? ' <span class="badge live">new</span>' : ""}</h2>
    <div class="muted">${esc(c.id)} · ${esc(c.file.source || "not saved yet")} · ${esc(c.ship.hullSize || "")}${c.isSkin ? " · skin of " + esc(c.skin.baseHullId) : ""}</div>
    <div class="muted" style="font-size:11px;word-break:break-all">${esc(c.file.path || "")}</div>
    <div class="btnrow">
      ${issues.length ? `<button data-act="showChecks" class="${errs ? "chk-err" : "chk-warn"}">${errs ? `⛔ ${errs} error${errs > 1 ? "s" : ""}` : ""}${errs && warns ? " · " : ""}${warns ? `⚠ ${warns} warning${warns > 1 ? "s" : ""}` : ""}</button>` : '<span class="chk-ok">✓ No problems found</span>'}
      ${c.isSkin ? "" : '<button data-act="dupHull" title="Copy this hull under a new id">Duplicate hull…</button><button data-act="newSkin" title="Create a .skin based on this hull">New skin…</button><button data-act="resizeSprite" title="Make the ship bigger or smaller in game: resizes the sprite and scales slots, engines, bounds and radii to match">Resize sprite…</button>'}
      <button data-act="factions" title="Make factions know this ship, add its variants to fleet roles and set blueprint tags, so it appears in game">Factions & roles…</button>
      <button data-act="whereUsed" title="Find variants, skins, modules, wings, factions and roles that refer to this hull">Where used</button>
      <button data-act="files" title="Open this ship's files (hull, stats, variant, description, sprite) or show them in their folder">📂 Files</button>
    </div>
    ${pendingLine(c.uid)}`;
}

function renderDetail() {
  const c = S.cur, el = $("#ship-detail");
  if (!c) return;
  const body = { view: viewPanel, variant: variantPanel, slots: slotsPanel, engines: enginesPanel, bounds: boundsPanel, centers: centersPanel }[S.mode]();
  el.innerHTML = header() + body;
  const rv = $("#ship-detail .review-btn"); if (rv) rv.onclick = openChanges;
  renderPop();
  bindPanel();
  renderTabs();
}

/** Fields with data-bind="ship.path" / "variant.path" / "sel.prop" write straight into the model. */
function bindPanel() {
  document.querySelectorAll("#ship-detail [data-bind], #pop [data-bind]").forEach((inp) => {
    inp.onchange = () => {
      const [root, ...path] = inp.dataset.bind.split(".");
      let raw = inp.type === "checkbox" ? inp.checked : inp.value;
      if (inp.dataset.num !== undefined) raw = num(raw) ?? 0;
      if (inp.dataset.numOpt !== undefined) raw = raw === "" ? undefined : num(raw) ?? raw;
      if (inp.dataset.list !== undefined) raw = raw.split(",").map((x) => x.trim()).filter(Boolean);
      // Find the mirror twin before the edit: once a position changes, the two no longer line up.
      const t = root === "sel" && inp.dataset.twin !== undefined && mirrorOn() ? selTwin() : null;
      edit(() => {
        let obj = root === "ship" ? S.cur.ship : root === "variant" ? S.cur.variant : root === "skin" ? S.cur.skin : selObj();
        for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        const key = path[path.length - 1];
        if (root === "sel" && key === "id" && S.sel.kind === "slot" && obj.id !== raw) renameSlot(obj.id, raw);
        if (raw === undefined || (root === "skin" && (raw === "" || raw === false || (Array.isArray(raw) && !raw.length)) && !(key in (JSON.parse(S.cur.skinOrig) || {})))) delete obj[key];
        else obj[key] = raw;
        if (root === "skin" && key === "hullName") S.cur.ship.hullName = raw || S.cur.base.hullName;
        if ((root === "skin" || root === "ship") && key === "spriteName") loadShipSprite(S.cur);
        if (root === "sel" && key === "type" && raw === "LAUNCH_BAY" && S.sel.kind === "slot") makeBay(obj);
        if (t) {
          if (key === "type" && raw === "LAUNCH_BAY") makeBay(t);
          if (key === "angle") t.angle = -raw;
          else if (/^\d+$/.test(key)) { const l = loc(t), k = +key; if (k < l.length) l[k] = k % 2 ? -raw : raw; }
          else t[key] = raw;
        }
      });
    };
  });
  document.querySelectorAll("#ship-detail [data-ab]").forEach((i) => (i.onchange = () => {
    AB[i.dataset.ab] = i.type === "checkbox" ? i.checked : num(i.value) ?? AB[i.dataset.ab];
    localStorage.setItem("forge.autoBounds", JSON.stringify(AB));
  }));
  document.querySelectorAll("#ship-detail [data-act], #pop [data-act]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); ACTIONS[b.dataset.act](b.dataset, ev); }));
}
/** A launch bay is always a hidden mount and can't hold a weapon (fitted or built-in). */
function makeBay(slot) {
  slot.mount = "HIDDEN";
  const sh = S.cur.ship;
  if (sh.builtInWeapons && slot.id in sh.builtInWeapons) delete sh.builtInWeapons[slot.id];
  for (const g of (S.cur.variant && S.cur.variant.weaponGroups) || []) delete (g.weapons || {})[slot.id];
}
/** Keeps fitted and built-in weapons attached when a slot is renamed. */
function renameSlot(from, to) {
  const sh = S.cur.ship;
  if (sh.builtInWeapons && from in sh.builtInWeapons) { sh.builtInWeapons[to] = sh.builtInWeapons[from]; delete sh.builtInWeapons[from]; }
  for (const g of S.cur.variant.weaponGroups) if (from in g.weapons) { g.weapons[to] = g.weapons[from]; delete g.weapons[from]; }
}
function selObj() {
  const s = S.sel, sh = S.cur.ship;
  if (!s) return null;
  if (s.kind === "slot") return sh.weaponSlots[s.i];
  if (s.kind === "engine") return sh.engineSlots[s.i];
  return null;
}
function selTwin() {
  const s = S.sel, sh = S.cur.ship;
  if (!s) return null;
  const list = s.kind === "slot" ? sh.weaponSlots : sh.engineSlots;
  const t = twin(list.map(loc), s.i);
  return t >= 0 ? list[t] : null;
}
function updateLiveFields() {
  // Cheap refresh during drags: only the coordinate inputs of the current selection.
  const o = selObj();
  if (o) {
    document.querySelectorAll('#pop [data-bind="sel.locations.0"], #pop [data-bind="sel.location.0"]').forEach((i) => (i.value = loc(o)[0]));
    document.querySelectorAll('#pop [data-bind="sel.locations.1"], #pop [data-bind="sel.location.1"]').forEach((i) => (i.value = loc(o)[1]));
    const a = $('#pop [data-bind="sel.angle"]'); if (a) a.value = o.angle;
    const w = $('#pop [data-bind="sel.width"]'); if (w) w.value = o.width;
    const l = $('#pop [data-bind="sel.length"]'); if (l) l.value = o.length;
  }
}

const opt = (list, v) => list.map((x) => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("");
const field = (label, bind, v, extra = "") => `<label>${esc(label)}</label><input data-bind="${bind}" value="${esc(v ?? "")}" ${extra}>`;
const nfield = (label, bind, v, twinAware = true) => field(label, bind, v, `data-num ${twinAware ? "data-twin" : ""}`);

const SKIN_FIELDS = [
  ["hullName", "Name"], ["hullDesignation", "Designation"], ["spriteName", "Sprite"], ["tech", "Tech / manufacturer"],
  ["descriptionPrefix", "Description prefix", "text"], ["ordnancePoints", "Ordnance points", "num"], ["fleetPoints", "Fleet points", "num"],
  ["fighterBays", "Fighter bays", "num"], ["systemId", "Ship system id"], ["baseValueMult", "Base value mult", "num"],
  ["suppliesPerMonth", "Supplies / month", "num"], ["suppliesToRecover", "Supplies to recover", "num"],
  ["restoreToBaseHull", "Restore to base hull when repaired", "bool"],
];
const KNOWN_HINTS = ["CARRIER", "COMBAT", "CIVILIAN", "FREIGHTER", "TANKER", "LINER", "TRANSPORT", "STATION", "MODULE", "SHIP_WITH_MODULES",
  "UNDER_PARENT", "UNBOARDABLE", "HIDE_IN_CODEX", "PHASE", "NO_AUTO_ESCORT", "DO_NOT_SHOW_MODULES_IN_FLEET_LIST", "INDEPENDENT_MODULES",
  "RENDER_ENGINES_BELOW_HULL", "WEAPONS_FRONT_TO_BACK", "WEAPONS_BACK_TO_FRONT", "ALWAYS_PANIC", "NO_NEURAL_LINK", "DANGEROUS"];
function skinPanel(c) {
  const k = c.skin;
  return `<h3>Skin overrides <span class="muted">(${esc(fileName(c.file.path || c.id + ".skin"))})</span></h3>
    <div class="form">${SKIN_FIELDS.map(([key, label, kind]) => kind === "bool"
      ? `<label>${esc(label)}</label><input type="checkbox" data-bind="skin.${key}" ${k[key] ? "checked" : ""} style="width:auto">`
      : kind === "text" ? `<label>${esc(label)}</label><textarea data-bind="skin.${key}" rows="3">${esc(k[key] ?? "")}</textarea>`
      : key === "spriteName" ? `<label>${esc(label)}</label>${imgFieldHtml(`<input data-bind="skin.spriteName" value="${esc(k.spriteName ?? "")}" placeholder="(base hull)">`, k.spriteName || c.base.spriteName, "graphics/ships")}`
      : `<label>${esc(label)}</label><input data-bind="skin.${key}" ${kind === "num" ? "data-num-opt" : ""} value="${esc(k[key] ?? "")}" placeholder="(base hull)">`).join("")}
      <label>Tags</label><input data-bind="skin.tags" data-list value="${esc((k.tags || []).join(", "))}">
      <label>Add hints</label><input data-bind="skin.addHints" data-list value="${esc((k.addHints || []).join(", "))}">
      <label>Remove hints</label><input data-bind="skin.removeHints" data-list value="${esc((k.removeHints || []).join(", "))}">
    </div>
    <p class="muted" style="font-size:12px">Slot and engine changes, removals and built-in weapons/hullmods/wings are worked out automatically from your edits in the other modes, compared with the base hull <b>${esc(k.baseHullId)}</b>.</p>
    <details><summary class="muted">Raw .skin JSON (as it will be saved)</summary><pre class="rawjson">${esc(prettyJson(buildSkin(c)))}</pre></details>`;
}
function hintToggles(csv) {
  const have = new Set(String(csv.hints || "").split(",").map((x) => x.trim()).filter(Boolean));
  const all = [...new Set([...KNOWN_HINTS, ...have])];
  return `<div class="hint-chips">${all.map((h) => `<button class="hchip${have.has(h) ? " on" : ""}" data-act="toggleHint" data-hint="${esc(h)}">${esc(h)}</button>`).join("")}</div>`;
}
function viewPanel() {
  const c = S.cur, csv = c.csv;
  const issues = checkShip(c);
  const checks = issues.length ? `<h3 id="checks">Checks</h3><div class="checks">${issues.map((x, i) => `
      <div class="chk ${x.level}" ${x.go ? `data-act="goIssue" data-i="${i}"` : ""}>${x.level === "error" ? "⛔" : x.level === "warn" ? "⚠" : "ℹ"} ${esc(x.msg)}${x.go ? ' <span class="muted">→</span>' : ""}</div>`).join("")}</div>` : "";
  const stats = c.isSkin ? skinPanel(c)
    : !Object.keys(csv).length ? '<p class="muted">No ship_data.csv row found for this hull.</p>'
    : `<h3>Stats <span class="muted">(ship_data.csv)</span></h3>
       <div id="ship-stats">${csvGroups(csv, SHIP_STAT_GROUPS, { readonly: ["id"] })}</div>
       <h3>Hints</h3>${hintToggles(csv)}`;
  const desc = c.isSkin
    ? `<h3>Description</h3><div class="desc-text muted">${esc([c.skin.descriptionPrefix, c.baseDesc && c.baseDesc.text1].filter(Boolean).join("\n\n") || "No description.")}</div>
       <p class="muted" style="font-size:12px">Skins show the base hull's description with the prefix above in front of it.</p>`
    : `<h3>Description <span class="muted">(descriptions.csv)</span></h3>
       <textarea id="ship-desc-edit" rows="7" style="width:100%" placeholder="No description yet">${esc(c.desc ? c.desc.text1 || "" : "")}</textarea>`;
  setTimeout(() => {
    const el = $("#ship-stats"); if (el) bindCsv(el, csv, (col) => { if (col === "hints") { const h = $(".hint-chips"); if (h) h.outerHTML = hintToggles(csv); bindPanel(); } });
    const d = $("#ship-desc-edit");
    if (d) d.oninput = () => { c.desc = c.desc || { id: c.id, type: "SHIP", text1: "", _source: null, _file: null }; c.desc.text1 = d.value; scheduleSync(); };
  });
  return `${checks}${stats}${desc}
    <h3>Geometry</h3><table class="kv">
      <tr><td>Weapon slots</td><td>${c.ship.weaponSlots.length}</td></tr><tr><td>Engines</td><td>${c.ship.engineSlots.length}</td></tr>
      <tr><td>Bound points</td><td>${c.ship.bounds.length / 2}</td></tr><tr><td>Sprite</td><td style="word-break:break-all">${esc(c.sprite)}</td></tr></table>`;
}

// ---------------------------------------------------------------- slots
const fmtN = (v) => (v == null || isNaN(v) ? "—" : Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
/** Fitted weapon summary for a slot: sprite, key stats and (approximate) sustained DPS/flux. */
function weaponCard(slot) {
  if (slot.type === "STATION_MODULE") return moduleCard(slot);
  const sh = S.cur.ship, bi = (sh.builtInWeapons || {})[slot.id], wid = bi || slotWeapons()[slot.id];
  const canFit = !["LAUNCH_BAY", "STATION_MODULE"].includes(slot.type);
  const btns = `<div class="btnrow">${canFit && !bi ? `<button data-act="fitHere">${wid ? "Change weapon…" : "Fit weapon…"}</button>` : ""}
    ${wid && !bi ? `<button data-act="clearHere">Remove</button>` : ""}</div>`;
  if (!wid) return `<div class="wcard empty"><span class="muted">${canFit ? "No weapon fitted in the current variant." : "This slot type doesn't take weapons."}</span>${btns}</div>`;
  const w = S.weapons[wid];
  if (!w) return `<div class="wcard"><b>${esc(wid)}</b> <span class="muted">(not found in loaded data)</span>${btns}</div>`;
  const n = (k) => num(w[k]);
  const beam = n("damage/second") != null && n("damage/shot") == null;
  const burst = n("burst size") || 1;
  const cycle = (n("chargeup") || 0) + (n("chargedown") || 0) + (burst - 1) * (n("burst delay") || 0);
  const dps = beam ? n("damage/second") : n("damage/shot") != null && cycle > 0 ? (n("damage/shot") * burst) / cycle : null;
  const fps = beam ? n("energy/second") : n("energy/shot") != null && cycle > 0 ? (n("energy/shot") * burst) / cycle : null;
  const img = slot.mount === "HARDPOINT" ? w._hardpointSprite || w._turretSprite : w._turretSprite || w._hardpointSprite;
  const rows = [
    ["OP", w.OPs], ["Range", w.range], ["Damage type", w.type],
    beam ? ["Damage/sec", w["damage/second"]] : ["Damage/shot", w["damage/shot"]],
    ["≈ DPS", fmtN(dps)], ["≈ Flux/sec", fmtN(fps)],
    ["EMP", w.emp], ["Turn rate", w["turn rate"]], ["Ammo", w.ammo], ["Proj. speed", w["proj speed"]],
  ].filter(([, v]) => v !== undefined && v !== "" && v !== "—" && v !== null);
  return `<div class="wcard">
    <div class="wtop"><img src="${asset(img)}" alt=""><div><b>${esc(w.name || wid)}</b>${bi ? ' <span class="badge restart">built-in</span>' : ""}
      <div class="muted" style="font-size:11px">${esc(w._size || "")} ${esc(w._mountType || "")} · ${esc(w._source)}</div></div></div>
    <table class="kv">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>${btns}</div>`;
}
function slotForm(o) {
  const sh = S.cur.ship, bi = (sh.builtInWeapons && sh.builtInWeapons[o.id]) || "";
  const l = loc(o), bay = o.type === "LAUNCH_BAY";
  const bayPts = bay ? `<h4 style="margin-top:8px">Launch points (${l.length / 2})</h4><div class="form">${Array.from({ length: l.length / 2 }, (_, k) => `
      <label>#${k + 1} ${S.sel.p === k ? "◀" : ""}</label><div class="row" style="gap:4px"><input data-bind="sel.locations.${k * 2}" data-num data-twin value="${l[k * 2]}"><input data-bind="sel.locations.${k * 2 + 1}" data-num data-twin value="${l[k * 2 + 1]}">
      ${l.length > 2 ? `<button data-act="removeBayPoint" data-k="${k}" title="Remove this point">✕</button>` : ""}</div>`).join("")}</div>
      <div class="btnrow"><button data-act="addBayPoint">Add launch point</button></div>
      <div class="muted" style="font-size:11px">Fighters launch from these points. Drag them on the ship like any slot.</div>
      <div class="muted" style="font-size:11px;margin-top:6px">A launch bay is always a hidden mount, and size, angle and arc have no effect on it, so they aren't shown.
        Ids like <code>WS 012</code> are normal: the game names bays the same way as weapon slots.
        How many wings the ship carries is set by <b>Fighter bays</b> in its stats (${fighterBays()} now); bay slots only set where fighters launch from.</div>` : "";
  return `<h4><span style="color:${slotColor(o.type)}">●</span> Slot ${esc(o.id)}<span class="spacer"></span><button data-act="closePop" title="Close (Esc)">✕</button></h4>
    ${bay ? "" : weaponCard(o)}<div class="form" style="margin-top:8px">
      ${field("Id", "sel.id", o.id, S.cur.isSkin ? "readonly title='Skins can't rename slots'" : "")}
      <label>Type</label><select data-bind="sel.type" data-twin>${opt(SLOT_TYPES, o.type)}</select>
      ${bay ? "" : `<label>Size</label><select data-bind="sel.size" data-twin>${opt(SIZES, o.size)}</select>
      <label>Mount</label><select data-bind="sel.mount" data-twin>${opt(MOUNTS, o.mount)}</select>
      ${nfield("Angle", "sel.angle", o.angle)}${nfield("Arc", "sel.arc", o.arc)}`}
      ${bay ? "" : nfield("Forward (x)", "sel.locations.0", loc(o)[0]) + nfield("Left (y)", "sel.locations.1", loc(o)[1])}
      ${nfield("Render order", "sel.renderOrderMod", o.renderOrderMod ?? 0)}
    </div>${bayPts}
    <div class="btnrow">${bay || o.type === "STATION_MODULE" ? "" : `<button data-act="builtinWeapon">`}${bay || o.type === "STATION_MODULE" ? "" : `${bi ? "Built-in: " + esc((S.weapons[bi] || {}).name || bi) : "Set built-in weapon…"}</button>`}
      ${bi ? `<button data-act="clearBuiltinWeapon">Clear built-in</button>` : ""}
      <button data-act="deleteSel">Delete slot</button></div>
    ${mirrorOn() && selTwin() ? `<div class="muted" style="font-size:11px;margin-top:4px">Mirror is on: every change here (except the id) also applies to <b>${esc(selTwin().id)}</b>, including weapons.</div>` : ""}`;
}
function slotsPanel() {
  const sh = S.cur.ship;
  return `<p class="muted">Click a slot on the ship to edit it in place. Shift+click empty space to add one.</p><h3>Slots (${sh.weaponSlots.length})</h3><div class="chips">${sh.weaponSlots.map((s, i) => `
    <div class="chip${S.sel && S.sel.kind === "slot" && S.sel.i === i ? " sel" : ""}" data-act="selectSlot" data-i="${i}">
      <span style="color:${slotColor(s.type)}">●</span><span class="grow">${esc(s.id)} · ${s.type === "LAUNCH_BAY" ? `launch bay · ${Math.max(1, Math.floor(loc(s).length / 2))} point(s)` : `${esc(s.size)} ${esc(s.type)} ${esc(s.mount)}`}</span>
      <span class="muted">${s.type === "LAUNCH_BAY" ? "" : esc(s.arc) + "°"}</span></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- engines
function engineForm(o) {
  const styles = Object.keys(S.styles.engine).concat(["CUSTOM"]);
  return `<h4><span style="color:${rgba(engineColor(o), 1)}">▲</span> Engine ${S.sel.i + 1}<span class="spacer"></span><button data-act="closePop" title="Close (Esc)">✕</button></h4><div class="form">
      ${nfield("Forward (x)", "sel.location.0", loc(o)[0])}${nfield("Left (y)", "sel.location.1", loc(o)[1])}
      ${nfield("Angle", "sel.angle", o.angle)}${nfield("Length", "sel.length", o.length)}${nfield("Width", "sel.width", o.width)}
      ${nfield("Contrail size", "sel.contrailSize", o.contrailSize)}
      <label>Style</label><select data-bind="sel.style" data-twin>${opt(styles, o.style)}</select>
      ${o.style === "CUSTOM" ? field("Style id", "sel.styleId", o.styleId || "", "data-twin") : ""}
    </div>
    ${o.style === "CUSTOM" && typeof jformHtml === "function" ? `<div class="muted" style="font-size:11px;margin-top:6px">Custom style (styleSpec), used when no style id is set:</div>` + jformHtml("engsel", o, [
      { p: "styleSpec.engineColor", l: "Flame colour", k: "color" }, { p: "styleSpec.contrailColor", l: "Contrail colour", k: "color" },
      { p: "styleSpec.glowSizeMult", l: "Glow size mult", k: "num" }, { p: "styleSpec.contrailDuration", l: "Contrail duration", k: "num" }]) : ""}
    <div style="margin-top:6px;display:flex;gap:8px;align-items:center"><span class="muted">Flame colour</span>
      <span style="display:inline-block;width:40px;height:14px;border-radius:3px;background:${rgba(engineColor(o), 1)}"></span></div>
    <div class="btnrow"><button data-act="deleteSel">Delete engine</button></div>
    ${mirrorOn() && selTwin() ? `<div class="muted" style="font-size:11px;margin-top:4px">Mirror is on: changes also apply to engine ${S.cur.ship.engineSlots.indexOf(selTwin()) + 1}.</div>` : ""}`;
}
function enginesPanel() {
  const sh = S.cur.ship;
  return `<p class="muted">Click an engine on the ship to edit it in place. Shift+click empty space to add one.</p><h3>Engines (${sh.engineSlots.length})</h3><div class="chips">${sh.engineSlots.map((e, i) => `
    <div class="chip${S.sel && S.sel.kind === "engine" && S.sel.i === i ? " sel" : ""}" data-act="selectEngine" data-i="${i}">
      <span style="color:${rgba(engineColor(e), 1)}">▲</span><span class="grow">#${i + 1} · ${esc(e.style)}${e.styleId ? " / " + esc(e.styleId) : ""}</span>
      <span class="muted">${esc(e.length)}×${esc(e.width)} @ ${esc(e.angle)}°</span></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- popup editor (anchored to the selected slot/engine)
function variantSlotPop(o) {
  const t = slotTwin(o);
  return `<h4><span style="color:${slotColor(o.type)}">●</span> ${esc(o.id)} <span class="muted" style="font-weight:normal">${esc(o.size)} ${esc(o.type)} ${esc(o.mount)}</span>
    <span class="spacer"></span><button data-act="closePop" title="Close (Esc)">✕</button></h4>${weaponCard(o)}
    ${t ? `<div class="muted" style="font-size:11px;margin-top:4px">Mirror is on: weapon changes also apply to <b>${esc(t.id)}</b>.</div>` : ""}`;
}
function popTarget() {
  const c = S.cur, s = S.sel;
  if (!c || !s) return null;
  if (s.kind === "slot" && (S.mode === "slots" || S.mode === "variant")) return c.ship.weaponSlots[s.i] || null;
  if (s.kind === "engine" && S.mode === "engines") return c.ship.engineSlots[s.i] || null;
  return null;
}
function renderPop() {
  const pop = $("#pop"), o = popTarget();
  if (!o) { pop.classList.add("hidden"); pop.innerHTML = ""; return; }
  pop.innerHTML = S.sel.kind === "slot" ? (S.mode === "variant" ? variantSlotPop(o) : slotForm(o)) : engineForm(o);
  pop.classList.remove("hidden");
  positionPop();
  const jf = pop.querySelector(".jform");
  if (jf && typeof bindJform === "function") bindJform(jf, () => { pushUndo(); return selObj(); }, () => { draw(); scheduleSync(); });
}
function positionPop() {
  const pop = $("#pop"), o = popTarget();
  if (!o || pop.classList.contains("hidden")) return;
  const pane = $(".view-pane").getBoundingClientRect(), cr = cv.getBoundingClientRect();
  const [x, y] = toScreen(loc(o)[0], loc(o)[1]);
  const w = pop.offsetWidth || 270, h = pop.offsetHeight || 300;
  let left = cr.left - pane.left + x + 28, top = cr.top - pane.top + y - 40;
  if (left + w > pane.width - 6) left = cr.left - pane.left + x - w - 28;   // flip to the left side
  top = Math.max(cr.top - pane.top + 4, Math.min(top, pane.height - h - 6));
  pop.style.left = Math.max(4, left) + "px"; pop.style.top = top + "px";
}

// ---------------------------------------------------------------- bounds
function boundsPanel() {
  const sh = S.cur.ship, pts = boundPts(), s = S.sel && S.sel.kind === "bound" ? pts[S.sel.i] : null;
  return `<h3>Bounds (${pts.length} points)</h3>
    ${s ? `<p>Point ${S.sel.i + 1}: forward ${s[0]}, left ${s[1]}</p>` : `<p class="muted">Drag points; Shift+click near an edge to insert one.</p>`}
    <div class="btnrow">
      ${s ? `<button data-act="deleteSel">Delete point</button>` : ""}
      <button data-act="mirrorBounds" title="Rebuild the right side as a mirror of the left side (positive y)">Mirror left side → right</button>
      <button data-act="clearBounds">Clear all</button>
    </div>
    <h3>Auto-generate from sprite</h3>
    <div class="form">
      <label>Points</label><input type="number" min="4" max="200" data-ab="points" value="${AB.points}">
      <label>Fill gaps (px)</label><input type="number" min="0" max="30" data-ab="gap" value="${AB.gap}">
      <label>Padding (px)</label><input type="number" min="0" max="10" data-ab="pad" value="${AB.pad}">
      <label>Alpha cutoff</label><input type="number" min="0" max="254" data-ab="alpha" value="${AB.alpha}">
      <label>Convex hull</label><input type="checkbox" data-ab="convex" ${AB.convex ? "checked" : ""} style="width:auto">
      <label>Symmetric</label><input type="checkbox" data-ab="symmetric" ${AB.symmetric ? "checked" : ""} style="width:auto">
    </div>
    <div class="btnrow"><button class="primary" data-act="autoBounds">Generate bounds</button></div>
    <p class="muted" style="font-size:12px">Traces the sprite's outline. “Fill gaps” joins separate parts (raise it for ships with detached pieces); “Symmetric” mirrors one side so both match. Undo with Ctrl+Z.</p>
    <p class="muted" style="margin-top:10px">Collision radius should enclose all points; use the Centers mode to check or recompute it.</p>`;
}

// ---------------------------------------------------------------- centers
function centersPanel() {
  const sh = S.cur.ship;
  return `<h3>Ship center</h3><div class="form">
      ${field("Center x (px)", "ship.center.0", sh.center[0], "data-num")}${field("Center y (px)", "ship.center.1", sh.center[1], "data-num")}
    </div><p class="muted">Changing the numbers here moves the origin only. Dragging the pink cross also keeps every point fixed on the sprite.</p>
    <h3>Shield</h3><div class="form">
      ${field("Shield x", "ship.shieldCenter.0", (sh.shieldCenter || [0, 0])[0], "data-num")}${field("Shield y", "ship.shieldCenter.1", (sh.shieldCenter || [0, 0])[1], "data-num")}
      ${field("Shield radius", "ship.shieldRadius", sh.shieldRadius ?? 0, "data-num")}
    </div>
    <h3>Collision</h3><div class="form">${field("Collision radius", "ship.collisionRadius", sh.collisionRadius ?? 0, "data-num")}</div>
    <div class="btnrow"><button data-act="autoCollision">Fit collision radius to bounds</button><button data-act="shieldToCenter">Shield to ship center</button></div>
    <h3>Module anchor <span class="muted">(only for hulls used as station modules)</span></h3>
    ${Array.isArray(sh.moduleAnchor) ? `<div class="form">${field("Anchor x", "ship.moduleAnchor.0", sh.moduleAnchor[0], "data-num")}${field("Anchor y", "ship.moduleAnchor.1", sh.moduleAnchor[1], "data-num")}</div>
      <p class="muted" style="font-size:12px">The orange cross. This point is attached to the parent's module slot. Drag it on the ship.</p>
      <div class="btnrow"><button data-act="removeAnchor">Remove module anchor</button></div>`
      : `<div class="btnrow"><button data-act="addAnchor">Add module anchor</button></div>`}
    <h3>Sprite</h3><div class="form"><label>Sprite</label>${imgFieldHtml(`<input data-bind="ship.spriteName" value="${esc(sh.spriteName ?? "")}">`, sh.spriteName, "graphics/ships")}${field("Width", "ship.width", sh.width, "data-num")}${field("Height", "ship.height", sh.height, "data-num")}</div>`;
}

// ---------------------------------------------------------------- variant
function fighterBays(c = S.cur) { return num(c.skin && c.skin.fighterBays != null ? c.skin.fighterBays : c.csv["fighter bays"]) || 0; }
function hullSize() { return S.cur.ship.hullSize || (S.hullById[S.cur.id] || {}).hullSize || "FRIGATE"; }
function hullmodCost(id) { const h = S.hullmodById[id]; return h ? num(h[COST_COL[hullSize()]]) || 0 : 0; }
function opBudget() {
  const c = S.cur, sh = c.ship, total0 = num(c.skin && c.skin.ordnancePoints != null ? c.skin.ordnancePoints : c.csv["ordnance points"]) || 0;
  if (!c.variant) return { weapons: 0, mods: 0, wings: 0, vents: 0, used: 0, total: total0 }; // brand-new hull: no variant yet
  const v = c.variant, built = new Set(sh.builtInMods || []), smods = new Set(v.sMods || []);
  const bi = sh.builtInWeapons || {}, biWings = new Set(sh.builtInWings || []);
  let weapons = 0, mods = 0, wings = 0;
  // Heavy Ballistics Integration (vanilla, e.g. Onslaught): large ballistic weapons cost 10 OP less
  const hbi = built.has("hbi") || (v.hullMods || []).includes("hbi") || (v.sMods || []).includes("hbi");
  for (const g of v.weaponGroups || []) for (const [slot, w] of Object.entries(g.weapons || {})) {
    if (bi[slot]) continue;
    const wd = S.weapons[w] || {}; let cost = num(wd.OPs) || 0;
    if (hbi && wd._size === "LARGE" && wd._mountType === "BALLISTIC") cost = Math.max(0, cost - 10);
    weapons += cost;
  }
  for (const m of new Set(v.hullMods || [])) if (!built.has(m) && !smods.has(m)) mods += hullmodCost(m);
  for (const w of v.wings || []) if (w && !biWings.has(w)) wings += num((S.wingById[w] || {})["op cost"]) || 0;
  const vents = (v.fluxVents || 0) + (v.fluxCapacitors || 0);
  const total = num(c.skin && c.skin.ordnancePoints != null ? c.skin.ordnancePoints : c.csv["ordnance points"]) || 0;
  return { weapons, mods, wings, vents, used: weapons + mods + wings + vents, total };
}
function hullmodDescFor(h, size) {
  let i = 0;
  const params = h._params && h._params[size];
  return esc(h.desc || "").replace(/%s/g, () => { const v = params && params[i++]; return v == null ? '<span class="hl muted">%s</span>' : `<span class="hl">${esc(v)}</span>`; });
}
function modChip(id, removeAct, extra = "") {
  const h = S.hullmodById[id] || { name: id };
  return `<div class="chip" title="${esc((h.desc || "").slice(0, 300))}"><img src="${asset(h.sprite)}" alt="">
    <span class="grow">${esc(h.name || id)} <span class="muted">${esc(id)}</span></span>${extra}
    ${removeAct ? `<button data-act="${removeAct}" data-id="${esc(id)}">✕</button>` : ""}</div>`;
}
function variantPanel() {
  if (!S.cur.variant) return '<p class="muted">Loading variant…</p>'; // still being loaded or created
  const c = S.cur, v = c.variant, sh = c.ship, b = opBudget(), size = hullSize();
  const built = sh.builtInMods || [], smods = new Set(v.sMods || []);
  const varOpts = c.variants.map((x) => `<option value="${esc(x.path)}"${c.variantFile && x.path === c.variantFile.path ? " selected" : ""}>${esc(x.variantId)}${x.displayName ? " — " + esc(x.displayName) : ""} (${esc(x.source)})</option>`).join("");
  const sw = slotWeapons(), bi = sh.builtInWeapons || {};
  const bays = Math.max(0, fighterBays() - (sh.builtInWings || []).length);
  const modSlots = sh.weaponSlots.filter((s) => s.type === "STATION_MODULE"), modMap = variantModules(v);
  const maxV = MAX_VENTS[size] ?? 30;
  const mods = v.hullMods.filter((m) => !built.includes(m));
  return `
    <h3>Variant</h3>
    <select id="variant-sel" style="width:100%">${c.variantFile ? "" : "<option selected>(new, unsaved)</option>"}${varOpts}</select>
    <div class="btnrow"><button data-act="newVariant">New empty variant</button><button data-act="copyVariant">Duplicate as new id</button></div>
    <div class="form" style="margin-top:6px">${field("Variant id", "variant.variantId", v.variantId)}${field("Display name", "variant.displayName", v.displayName)}</div>

    <h3>Ordnance points</h3>
    <div class="op${b.used > b.total ? " over" : ""}">${b.used} / ${b.total} OP</div>
    <div class="muted" style="font-size:12px">weapons ${b.weapons} · hullmods ${b.mods} · wings ${b.wings} · vents/caps ${b.vents}</div>
    <div class="form" style="margin-top:6px">
      <label>Flux vents</label><input type="number" min="0" max="${maxV}" data-bind="variant.fluxVents" data-num value="${v.fluxVents}">
      <label>Flux capacitors</label><input type="number" min="0" max="${maxV}" data-bind="variant.fluxCapacitors" data-num value="${v.fluxCapacitors}">
    </div>

    <h3>Hullmods</h3>
    <div class="chips">${mods.map((m) => modChip(m, "removeMod", `${smods.has(m) ? '<span class="badge live">S-mod</span>' : `<span class="muted">${hullmodCost(m)} OP</span>`}`)).join("") || '<span class="muted">None</span>'}</div>
    <div class="btnrow"><button data-act="addMod">Add hullmod…</button><button data-act="addSMod">Add S-mod…</button></div>

    <h3>Built-in hullmods <span class="muted">(hull file)</span></h3>
    <div class="chips">${built.map((m) => modChip(m, "removeBuiltin")).join("") || '<span class="muted">None</span>'}</div>
    <div class="btnrow"><button data-act="addBuiltin">Add built-in hullmod…</button></div>
    ${c.isSkin ? '<p class="muted" style="font-size:12px">Saved in the .skin as additions/removals relative to the base hull.</p>' : ""}

    <h3>Weapons</h3>
    <div class="chips">${sh.weaponSlots.filter((s) => s.type !== "LAUNCH_BAY" && s.type !== "STATION_MODULE").map((s) => {
      const w = sw[s.id], wd = S.weapons[w] || {};
      return `<div class="chip${S.sel && S.sel.kind === "slot" && sh.weaponSlots[S.sel.i] === s ? " sel" : ""}" data-act="pickWeapon" data-id="${esc(s.id)}">
        <span style="color:${slotColor(s.type)}">●</span>
        <span class="grow">${esc(s.id)} <span class="muted">${esc((s.size || "?")[0])} ${esc(s.type)}</span> · ${w ? esc(wd.name || w) : '<span class="muted">empty</span>'}</span>
        ${bi[s.id] ? '<span class="badge restart">built-in</span>' : w ? `<span class="muted">${esc(wd.OPs || 0)} OP</span>` : ""}</div>`;
    }).join("")}</div>
    <div class="btnrow"><button data-act="stripWeapons">Remove all weapons</button><button data-act="autoGroups">Regroup weapons by type</button></div>

    ${weaponGroupsPanel(v)}

    ${modSlots.length ? `<h3>Station modules</h3><div class="chips">${modSlots.map((s) => {
      const mv = modMap[s.id], e = mv && moduleInfo(mv);
      return `<div class="chip" data-act="pickModule" data-id="${esc(s.id)}"><span style="color:${slotColor(s.type)}">●</span>
        <span class="grow">${esc(s.id)} · ${mv ? esc(mv) + (e && e.hull ? ' <span class="muted">' + esc(e.hull.hullName || e.hull.hullId) + "</span>" : "") : '<span class="muted">empty</span>'}</span>
        ${mv ? `<button data-act="clearModule" data-id="${esc(s.id)}">✕</button>` : ""}</div>`;
    }).join("")}</div>` : ""}

    <h3>Fighter bays <span class="muted">(${fighterBays()} total)</span></h3>
    <div class="chips">
      ${(sh.builtInWings || []).map((w, i) => `<div class="chip"><span class="grow">${esc(w)} <span class="muted">${esc((S.wingById[w] || {}).role || "")}</span></span><span class="badge restart">built-in</span><button data-act="removeBuiltinWing" data-i="${i}" title="Remove from the hull">✕</button></div>`).join("")}
      ${Array.from({ length: bays }, (_, i) => { const w = v.wings[i]; const wd = S.wingById[w] || {};
        return `<div class="chip" data-act="pickWing" data-i="${i}"><span class="grow">Bay ${(sh.builtInWings || []).length + i + 1}: ${w ? esc(w) : '<span class="muted">empty</span>'}</span>${w ? `<span class="muted">${esc(wd["op cost"] || 0)} OP</span><button data-act="clearWing" data-i="${i}">✕</button>` : ""}</div>`; }).join("")}
      ${!fighterBays() && !(sh.builtInWings || []).length ? '<span class="muted">This hull has no fighter bays (set “fighter bays” in View mode stats).</span>' : ""}
    </div>
    <div class="btnrow"><button data-act="addBuiltinWing" ${(sh.builtInWings || []).length >= fighterBays() ? "disabled title='All bays are already built-in; raise fighter bays first'" : ""}>Add built-in wing…</button></div>
    <p class="muted" style="font-size:12px">Built-in wings are part of the hull file, cost no OP and fill the first bays.</p>`;
}

// ================================================================ AUTO BOUNDS
const AB = Object.assign({ points: 24, gap: 3, pad: 1, alpha: 24, convex: false, symmetric: true },
  JSON.parse(localStorage.getItem("forge.autoBounds") || "{}"));

/** Max-filter (dilate) or min-filter (erode) a binary mask with a square kernel, separably. */
function morph(mask, W, H, r, dilate) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = x + k, m = xx < 0 || xx >= W ? 0 : mask[row + xx];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    let v = dilate ? 0 : 1;
    for (let k = -r; k <= r; k++) {
      const yy = y + k, m = yy < 0 || yy >= H ? 0 : tmp[yy * W + x];
      if (dilate ? m : !m) { v = dilate ? 1 : 0; break; }
    }
    out[y * W + x] = v;
  }
  return out;
}
/** Keeps only the largest 4-connected blob. */
function largestBlob(mask, W, H) {
  const lab = new Int32Array(W * H), stack = [];
  let best = 0, bestSize = 0, id = 0;
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lab[i]) continue;
    id++; let size = 0; stack.push(i); lab[i] = id;
    while (stack.length) {
      const j = stack.pop(); size++;
      const x = j % W, y = (j / W) | 0;
      for (const n of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1])
        if (n >= 0 && mask[n] && !lab[n]) { lab[n] = id; stack.push(n); }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = lab[i] === best ? 1 : 0;
  return out;
}
/** Outer contour of a blob (Moore-neighbour tracing), as pixel-corner points. */
function traceContour(mask, W, H) {
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [[sx, sy]];
  let cx = sx, cy = sy, back = 4, guard = W * H * 4;
  do {
    let found = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8, nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; back = (d + 4) % 8; found = true; break; }
    }
    if (!found) break;
    pts.push([cx, cy]);
  } while ((cx !== sx || cy !== sy) && --guard > 0);
  return pts;
}
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** Ramer–Douglas–Peucker on an open chain (endpoints kept). */
function rdpOpen(seg, eps) {
  if (seg.length < 3) return seg.slice();
  const p0 = seg[0], p1 = seg[seg.length - 1];
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  let idx = 0, dmax = -1;
  for (let i = 1; i < seg.length - 1; i++) {
    const d = L ? Math.abs((p1[0] - p0[0]) * (p0[1] - seg[i][1]) - (p0[0] - seg[i][0]) * (p1[1] - p0[1])) / L
                : Math.hypot(seg[i][0] - p0[0], seg[i][1] - p0[1]);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [p0, p1];
  return rdpOpen(seg.slice(0, idx + 1), eps).slice(0, -1).concat(rdpOpen(seg.slice(idx), eps));
}
/** RDP for a closed polygon: split at the point farthest from the first one. */
function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts;
  let b = 0, far = -1;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > far) { far = d; b = i; } }
  const first = rdpOpen(pts.slice(0, b + 1), eps), second = rdpOpen(pts.slice(b).concat([pts[0]]), eps);
  return first.slice(0, -1).concat(second.slice(0, -1));
}
/** Simplifies to at most `n` points by searching for the smallest tolerance that gets there. */
function simplifyTo(pts, n, open) {
  const f = open ? rdpOpen : simplifyClosed;
  let lo = 0.05, hi = 128, best = f(pts, hi);
  for (let k = 0; k < 26; k++) {
    const mid = (lo + hi) / 2, r = f(pts, mid);
    if (r.length <= n) { best = r; hi = mid; } else lo = mid;
  }
  return best;
}

function generateBounds() {
  const c = S.cur, img = c.img;
  if (!img) { toast("The sprite hasn't loaded, so bounds can't be generated.", true); return; }
  const W = img.naturalWidth, H = img.naturalHeight;
  const cnv = document.createElement("canvas"); cnv.width = W; cnv.height = H;
  const g = cnv.getContext("2d"); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  // Work on a padded canvas so dilation near the sprite's edges isn't clipped.
  const P = AB.gap + AB.pad + 2, PW = W + P * 2, PH = H + P * 2;
  let mask = new Uint8Array(PW * PH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > AB.alpha) mask[(y + P) * PW + x + P] = 1;
  const sh = c.ship, cx = sh.center[0], cy = sh.center[1];
  if (AB.symmetric) {
    // Union with the mirror image across the ship's centerline, so the outline is symmetric to begin with.
    const axis2 = 2 * (cx + P), sym = mask.slice();
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) {
      const mx = Math.round(axis2 - x - 1);
      if (mask[y * PW + x] && mx >= 0 && mx < PW) sym[y * PW + mx] = 1;
    }
    mask = sym;
  }
  mask = morph(morph(mask, PW, PH, AB.gap, true), PW, PH, AB.gap, false); // close gaps between parts
  mask = largestBlob(mask, PW, PH);
  mask = morph(mask, PW, PH, AB.pad, true);
  let contour = traceContour(mask, PW, PH).map(([x, y]) => [x - P + 0.5, y - P + 0.5]);
  if (contour.length < 3) { toast("No opaque pixels found in the sprite.", true); return; }
  // pixel (top-left origin) -> ship coordinates [forward, left]
  let pts = (AB.convex ? convexHull(contour) : contour).map(([x, y]) => [H - cy - y, cx - x]);
  if (AB.symmetric) {
    // Walk one side of the (already symmetric) outline in order, from the nose to the tail, then mirror it.
    const near = pts.map((p, i) => [p, i]).filter(([p]) => Math.abs(p[1]) <= 1);
    const start = (near.length ? near : pts.map((p, i) => [p, i])).reduce((a, b) => (b[0][0] > a[0][0] ? b : a))[1];
    let ring = pts.slice(start).concat(pts.slice(0, start));
    if (ring.slice(1, 6).reduce((t, p) => t + p[1], 0) < 0) ring = [ring[0]].concat(ring.slice(1).reverse());
    const chain = [];
    for (let i = 0; i < ring.length; i++) { if (i > 2 && ring[i][1] < -0.75) break; chain.push([ring[i][0], Math.max(0, ring[i][1])]); }
    let side = simplifyTo(chain, Math.max(3, Math.ceil(AB.points / 2) + 1), true);
    side[0] = [side[0][0], 0]; side[side.length - 1] = [side[side.length - 1][0], 0];
    pts = side.concat(side.slice(1, -1).reverse().map((p) => [p[0], -p[1]]));
  } else pts = simplifyTo(pts, AB.points);
  edit(() => {
    sh.bounds = pts.flatMap((p) => [snapV(p[0]), snapV(p[1])]);
    S.sel = null;
  });
  toast(`Generated ${pts.length} bound points.`);
}

// ================================================================ ACTIONS
const ACTIONS = {
  selectSlot: (d) => { S.sel = { kind: "slot", i: +d.i }; draw(); renderDetail(); },
  selectEngine: (d) => { S.sel = { kind: "engine", i: +d.i }; draw(); renderDetail(); },
  deleteSel: () => deleteSelected(),
  addBayPoint: () => edit(() => {
    const o = selObj(), l = loc(o), t = selTwin(), n = l.length;
    l.push(snapV(l[n - 2] - 8), l[n - 1]);
    if (t && loc(t).length === n) loc(t).push(snapV(l[n - 2] - 8), -l[n - 1]);
    S.sel.p = l.length / 2 - 1;
  }),
  removeBayPoint: (d) => edit(() => {
    const o = selObj(), t = selTwin(), k = +d.k;
    if (t && loc(t).length === loc(o).length) loc(t).splice(k * 2, 2);
    loc(o).splice(k * 2, 2); S.sel.p = 0;
  }),
  pickModule: (d) => { const s = S.cur.ship.weaponSlots.find((x) => x.id === d.id); if (s) openModulePicker(s); },
  clearModule: (d) => edit(() => setModule(d.id, null)),
  moduleHere: () => { const s = S.cur.ship.weaponSlots[S.sel.i]; if (s) openModulePicker(s); },
  clearModuleHere: () => { const s = S.cur.ship.weaponSlots[S.sel.i]; if (s) edit(() => setModule(s.id, null)); },
  addBuiltinWing: () => openWingPicker(null, true),
  removeBuiltinWing: (d) => edit(() => { S.cur.ship.builtInWings.splice(+d.i, 1); }),
  addAnchor: () => edit(() => (S.cur.ship.moduleAnchor = [0, 0])),
  removeAnchor: () => edit(() => delete S.cur.ship.moduleAnchor),
  newGroup: () => edit(() => S.cur.variant.weaponGroups.push({ autofire: false, mode: "LINKED", weapons: {} })),
  deleteGroup: (d) => edit(() => S.cur.variant.weaponGroups.splice(+d.g, 1)),
  toggleHint: (d) => {
    const c = S.cur, set = String(c.csv.hints || "").split(",").map((x) => x.trim()).filter(Boolean);
    const i = set.indexOf(d.hint); if (i >= 0) set.splice(i, 1); else set.push(d.hint);
    c.csv.hints = set.join(", "); renderDetail(); scheduleSync();
  },
  showChecks: () => { setMode("view"); setTimeout(() => { const el = $("#checks"); if (el) el.scrollIntoView({ behavior: "smooth" }); }); },
  goIssue: (d) => {
    const x = checkShip(S.cur)[+d.i];
    if (!x || !x.go) return;
    if (x.go.mode) setMode(x.go.mode);
    if (x.go.sel) { S.sel = x.go.sel; draw(); renderDetail(); }
  },
  dupHull: () => duplicateHullDialog(),
  resizeSprite: () => resizeSpriteDialog(),
  newSkin: () => newSkinDialog(),
  closePop: () => { S.sel = null; draw(); renderDetail(); },
  clearBounds: () => { if (confirm("Remove all bound points?")) edit(() => { S.cur.ship.bounds = []; S.sel = null; }); },
  mirrorBounds: () => edit(() => {
    const pts = boundPts().filter((p) => p[1] >= 0);
    if (pts.length < 2) return;
    const right = pts.slice().reverse().filter((p) => Math.abs(p[1]) > 0.01).map((p) => [p[0], -p[1]]);
    S.cur.ship.bounds = pts.concat(right).flat(); S.sel = null;
  }),
  autoBounds: () => generateBounds(),
  autoCollision: () => edit(() => {
    const pts = boundPts();
    if (pts.length) S.cur.ship.collisionRadius = Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0], p[1]))));
  }),
  shieldToCenter: () => edit(() => (S.cur.ship.shieldCenter = [0, 0])),
  newVariant: () => { if (!isVariantDirty() || confirm("Discard unsaved variant changes?")) newVariant(); },
  copyVariant: () => {
    const id = prompt("New variant id:", S.cur.variant.variantId + "_copy");
    if (id) edit(() => { S.cur.variant.variantId = id; S.cur.variantFile = null; });
  },
  addMod: () => openHullmodPicker("variant"),
  addSMod: () => openHullmodPicker("smod"),
  addBuiltin: () => openHullmodPicker("builtin"),
  removeMod: (d) => edit(() => { const v = S.cur.variant; for (const k of ["hullMods", "permaMods", "sMods"]) v[k] = v[k].filter((x) => x !== d.id); }),
  removeBuiltin: (d) => edit(() => { S.cur.ship.builtInMods = S.cur.ship.builtInMods.filter((x) => x !== d.id); }),
  pickWeapon: (d) => {
    const i = S.cur.ship.weaponSlots.findIndex((x) => x.id === d.id);
    if (i < 0) return;
    S.sel = { kind: "slot", i }; draw(); renderDetail();
    openWeaponPicker(S.cur.ship.weaponSlots[i]);
  },
  fitHere: () => { const s = S.cur.ship.weaponSlots[S.sel.i]; if (s) openWeaponPicker(s); },
  clearHere: () => { const s = S.cur.ship.weaponSlots[S.sel.i]; if (s) fitWeapon(s, null, false); },
  builtinWeapon: () => { const s = selObj(); if (s) openWeaponPicker(s, true); },
  clearBuiltinWeapon: () => { const s = selObj(); if (s) fitWeapon(s, null, true); },
  stripWeapons: () => edit(() => (S.cur.variant.weaponGroups = [])),
  autoGroups: () => edit(() => regroup()),
  pickWing: (d) => openWingPicker(+d.i),
  clearWing: (d) => edit(() => (S.cur.variant.wings[+d.i] = null)),
};
$("#ship-detail").addEventListener("change", (e) => {
  if (e.target.dataset && e.target.dataset.movew) { moveWeaponToGroup(e.target.dataset.movew, e.target.value); return; }
  if (e.target.id === "variant-sel") { const entry = S.cur.variants.find((x) => x.path === e.target.value); if (entry) loadVariant(entry); }
});

/** The mirrored twin of a weapon slot, if Mirror is on and one exists. */
function slotTwin(slot) {
  if (!mirrorOn()) return null;
  const list = S.cur.ship.weaponSlots, t = twin(list.map(loc), list.indexOf(slot));
  return t >= 0 ? list[t] : null;
}
/** Puts a weapon into the variant (or the hull's built-ins), mirrored when Mirror is on, keeping groups tidy. */
function fitWeapon(slot, wid, builtin) {
  const tw = slotTwin(slot);
  edit(() => {
    const sh = S.cur.ship, v = S.cur.variant;
    for (const s of tw ? [slot, tw] : [slot]) {
      if (builtin) {
        sh.builtInWeapons = sh.builtInWeapons || {};
        if (wid) sh.builtInWeapons[s.id] = wid; else delete sh.builtInWeapons[s.id];
        continue;
      }
      if ((sh.builtInWeapons || {})[s.id]) continue; // a built-in on the twin stays put
      for (const g of v.weaponGroups) delete g.weapons[s.id];
      v.weaponGroups = v.weaponGroups.filter((g) => Object.keys(g.weapons).length);
      if (!wid) continue;
      const type = (S.weapons[wid] || {})._mountType;
      let g = v.weaponGroups.find((g) => Object.values(g.weapons).some((w) => (S.weapons[w] || {})._mountType === type));
      if (!g) { g = { autofire: type !== "MISSILE", mode: "LINKED", weapons: {} }; v.weaponGroups.push(g); }
      g.weapons[s.id] = wid;
    }
  });
  if (tw) toast(`${wid ? "Fitted" : "Cleared"} ${slot.id} and its mirror ${tw.id}.`);
}
function regroup() {
  const v = S.cur.variant, all = {};
  for (const g of v.weaponGroups) Object.assign(all, g.weapons);
  const groups = {};
  for (const [slot, w] of Object.entries(all)) { const t = (S.weapons[w] || {})._mountType || "OTHER"; (groups[t] = groups[t] || { autofire: t !== "MISSILE", mode: "LINKED", weapons: {} }).weapons[slot] = w; }
  v.weaponGroups = Object.values(groups);
}

// ================================================================ PICKER
const P = { items: [], render: null, onPick: null };
/** sourceIds: mod ids to offer in the "filter by mod" dropdown (omit to hide it). */
function openPicker(title, optLabel, render, onPick, sourceIds) {
  const sel = $("#picker-source");
  sel.style.display = sourceIds ? "" : "none";
  sel.length = 1;
  if (sourceIds) {
    const remembered = localStorage.getItem("forge.pickerSource") || "";
    for (const src of sourceOptions(sourceIds)) sel.add(new Option(src.label, src.id));
    sel.value = [...sel.options].some((o) => o.value === remembered) ? remembered : "";
  }
  $("#picker-title").textContent = title;
  $("#picker-opt-wrap").style.display = optLabel ? "" : "none";
  $("#picker-opt-label").textContent = optLabel || "";
  $("#picker-opt").checked = false;
  $("#picker-search").value = "";
  P.render = render; P.onPick = onPick;
  $("#picker").classList.remove("hidden");
  renderPicker(); $("#picker-search").focus();
}
function renderPicker() {
  const q = $("#picker-search").value.trim().toLowerCase();
  const src = $("#picker-source").style.display === "none" ? "" : $("#picker-source").value;
  const items = P.render(q, $("#picker-opt").checked, src);
  $("#picker-list").innerHTML = items.slice(0, 400).map((it, i) => `<div class="pick${it.dim ? " dim" : ""}" data-i="${i}">${it.html}</div>`).join("") ||
    '<p class="muted">Nothing matches.</p>';
  P.items = items;
}
function closePicker() { $("#picker").classList.add("hidden"); }
$("#picker-search").oninput = renderPicker; $("#picker-opt").onchange = renderPicker;
$("#picker-source").onchange = () => { localStorage.setItem("forge.pickerSource", $("#picker-source").value); renderPicker(); };
/** Dropdown entries for the mods that actually contribute items, vanilla first. */
function sourceOptions(ids) {
  const set = new Set(ids);
  return S.sources.filter((x) => set.has(x.id))
    .map((x) => ({ id: x.id, label: x.core ? "Vanilla" : x.name, core: x.core }))
    .sort((a, b) => (b.core - a.core) || a.label.localeCompare(b.label));
}
$("#picker-close").onclick = closePicker;
$("#picker").onclick = (e) => { if (e.target.id === "picker") closePicker(); };
$("#picker-list").onclick = (e) => { const it = e.target.closest(".pick"); if (it) { const item = P.items[+it.dataset.i]; closePicker(); P.onPick(item.value); } };
const matches = (q, ...xs) => !q || xs.some((x) => x && String(x).toLowerCase().includes(q));

function openHullmodPicker(target) {
  const v = S.cur.variant, sh = S.cur.ship, size = hullSize();
  const have = target === "builtin" ? new Set(sh.builtInMods) : new Set([...v.hullMods, ...(sh.builtInMods || [])]);
  const title = { variant: "Add hullmod", smod: "Add S-mod (built in permanently, no OP cost)", builtin: "Add built-in hullmod to the hull" }[target];
  openPicker(title, "Show hidden hullmods", (q, showHidden, src) => S.hullmods
    .filter((h) => (!src || h._source === src) && (showHidden || !/^true$/i.test(h.hidden || "")) && !/^true$/i.test(h.hiddenEverywhere || "") && matches(q, h.name, h.id, h._source, h.uiTags, h.tags))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)))
    .map((h) => ({
      value: h.id, dim: have.has(h.id),
      html: `<img src="${asset(h.sprite)}" alt=""><div><div><b>${esc(h.name || h.id)}</b> <span class="muted">${esc(h.id)}</span>
        ${have.has(h.id) ? '<span class="badge restart">installed</span>' : ""}</div>
        <div class="muted" style="font-size:11px">${esc(h._source)} · ${target === "variant" ? `<b>${hullmodCost(h.id)} OP</b> for ${esc(size.replace("_SHIP", "").toLowerCase())}` : "free"}${h.uiTags ? " · " + esc(h.uiTags) : ""}</div>
        <div class="desc">${hullmodDescFor(h, size)}</div></div>`,
    })),
  (id) => edit(() => {
    if (target === "builtin") { sh.builtInMods = sh.builtInMods || []; if (!sh.builtInMods.includes(id)) sh.builtInMods.push(id); return; }
    if (!v.hullMods.includes(id)) v.hullMods.push(id);
    if (target === "smod") { if (!v.sMods.includes(id)) v.sMods.push(id); }
  }), S.hullmods.map((h) => h._source));
}

function weaponFits(slot, w) {
  const types = COMPAT[slot.type] || [];
  const ws = SIZES.indexOf(w._size), ss = SIZES.indexOf(slot.size);
  return types.includes(w._mountType) && ws >= 0 && ws <= ss && ws >= ss - 1;
}
function openWeaponPicker(slot, builtin) {
  const current = builtin ? (S.cur.ship.builtInWeapons || {})[slot.id] : slotWeapons()[slot.id];
  openPicker(`${builtin ? "Built-in weapon" : "Weapon"} for ${slot.id} (${slot.size} ${slot.type} ${slot.mount})`, "Show weapons that don't fit", (q, all, src) => {
    const list = Object.values(S.weapons)
      .filter((w) => (!src || w._source === src) && (all || weaponFits(slot, w)) && matches(q, w.name, w.id, w._source, w._mountType))
      .sort((a, b) => (num(a.OPs) || 0) - (num(b.OPs) || 0) || String(a.name).localeCompare(String(b.name)))
      .map((w) => ({
        value: w.id, dim: !weaponFits(slot, w),
        html: `<img src="${asset(slot.mount === "HARDPOINT" ? w._hardpointSprite || w._turretSprite : w._turretSprite || w._hardpointSprite)}" alt="">
          <div><div><b>${esc(w.name || w.id)}</b> <span class="muted">${esc(w.id)}</span>${w.id === current ? ' <span class="badge live">fitted</span>' : ""}</div>
          <div class="muted" style="font-size:11px">${esc(w._size || "?")} ${esc(w._mountType || "?")} · ${esc(w.OPs || 0)} OP · range ${esc(w.range || "?")} · ${esc(w["damage/shot"] || w["damage/second"] || "?")} dmg · ${esc(w._source)}</div></div>`,
      }));
    return [{ value: null, html: `<div><b>(empty)</b><div class="muted">Remove the weapon from this slot</div></div>` }].concat(list);
  }, (wid) => fitWeapon(slot, wid, builtin), Object.values(S.weapons).map((w) => w._source));
}

async function openWingPicker(bay, builtin) {
  if (!S.allVariants) S.allVariants = Object.fromEntries((await api("/api/variants")).map((v) => [v.variantId, v]));
  openPicker(builtin ? "Add built-in wing to the hull" : `Fighter wing for bay ${bay + 1}`, "", (q, _o, src) => S.wings
    .filter((w) => (!src || w._source === src) && matches(q, w.id, w.role, w["role desc"], w._source))
    .sort((a, b) => (num(a["op cost"]) || 0) - (num(b["op cost"]) || 0))
    .map((w) => {
      const fv = S.allVariants[w.variant], fh = fv && S.hullById[fv.hullId];
      return { value: w.id, html: `<img src="${asset(fh && fh.spriteName)}" alt=""><div><div><b>${esc(w.id)}</b> <span class="muted">${esc(w.role || "")}</span></div>
        <div class="muted" style="font-size:11px">${esc(w["op cost"] || 0)} OP · ${esc(w.num || "?")} craft · refit ${esc(w.refit || "?")}s · ${esc(w._source)}</div>
        <div class="desc">${esc(w["role desc"] || "")}</div></div>` };
    }), (id) => edit(() => {
      if (builtin) { const sh = S.cur.ship; sh.builtInWings = (sh.builtInWings || []).concat([id]); return; }
      const v = S.cur.variant; while (v.wings.length < bay) v.wings.push(null); v.wings[bay] = id;
    }), S.wings.map((w) => w._source));
}

// ================================================================ SAVE
function fileName(p) { return String(p).split(/[\\/]/).pop(); }
function targetSource(currentSourceId) {
  const own = sourceById(currentSourceId);
  if (own && !own.core) return own;
  const t = sourceById($("#save-target").value);
  if (!t) { toast("Choose a mod in “Save to mod” (top right) first: vanilla files are never overwritten.", true); return null; }
  return t;
}
/** Ctrl+S: show the pending changes. */
async function saveAll() { await openChanges(); }

// ================================================================ COLOUR SETTINGS
const THEME_LABELS = [
  ["bounds", "Bounds"], ["select", "Selection highlight"], ["labels", "Selection label"], ["center", "Ship center"],
  ["shieldCenter", "Shield center"], ["collision", "Collision radius"], ["engineHandle", "Engine handles"],
  ["mirror", "Mirror axis"], ["background", "Background"], ["checkerA", "Checker (dark)"], ["checkerB", "Checker (light)"],
];
function renderSettings() {
  const row = (label, key, val) => `<label>${esc(label)}</label><input type="color" data-key="${key}" value="${val}"><span></span>`;
  $("#settings-body").innerHTML = `
    <h3 style="margin-top:0">Weapon arcs</h3>
    <div class="swatches">
      <label>Arc colour</label>
      <select id="arc-mode"><option value="type"${THEME.arcMode === "type" ? " selected" : ""}>Same as slot type</option><option value="custom"${THEME.arcMode === "custom" ? " selected" : ""}>Custom colour</option></select>
      <input type="color" data-key="arcColor" value="${THEME.arcColor}">
      <label>Arc opacity</label><input type="range" min="5" max="80" id="arc-opacity" value="${THEME.arcOpacity}"><span id="arc-op-val">${THEME.arcOpacity}%</span>
    </div>
    <h3>Slot types</h3>
    <div class="swatches">${SLOT_TYPES.map((t) => row(t, "slot." + t, THEME.slot[t])).join("")}</div>
    <h3>Overlays</h3>
    <div class="swatches">${THEME_LABELS.map(([k, l]) => row(l, k, THEME[k])).join("")}</div>
    <p class="muted">Changes apply immediately and are remembered in this browser.</p>`;
  $("#settings-body").querySelectorAll("input[type=color]").forEach((i) => (i.oninput = () => {
    const k = i.dataset.key;
    if (k.startsWith("slot.")) THEME.slot[k.slice(5)] = i.value; else THEME[k] = i.value;
    saveTheme(); if (S.cur) renderDetail();
  }));
  $("#arc-mode").onchange = (e) => { THEME.arcMode = e.target.value; saveTheme(); };
  $("#arc-opacity").oninput = (e) => { THEME.arcOpacity = +e.target.value; $("#arc-op-val").textContent = e.target.value + "%"; saveTheme(); };
}
$("#open-settings").onclick = () => { renderSettings(); $("#settings").classList.remove("hidden"); };
$("#settings-close").onclick = () => $("#settings").classList.add("hidden");
$("#settings").onclick = (e) => { if (e.target.id === "settings") $("#settings").classList.add("hidden"); };
$("#theme-reset").onclick = () => { THEME = clone(THEME_DEFAULTS); saveTheme(); renderSettings(); if (S.cur) renderDetail(); };

// ================================================================ WEAPONS TAB (browser)
function weaponSprite(w) { return w._turretSprite || w._hardpointSprite; }
function renderWeaponList() {
  const q = $("#weapon-search").value.trim().toLowerCase(), size = $("#weapon-size").value, type = $("#weapon-type").value, src = $("#weapon-source").value;
  const list = Object.values(S.weapons).filter((w) =>
    (!src || w._source === src || !w._source) && (!size || w._size === size) && (!type || w._mountType === type) && matches(q, w.name, w.id, w._source))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  $("#weapon-count").textContent = list.length + " weapons";
  $("#weapon-list").innerHTML = list.slice(0, 700).map((w) => `
    <div class="item" data-id="${esc(w.id)}"><img loading="lazy" src="${asset(weaponSprite(w))}" alt="">
    <div class="t"><div class="n">${esc(w.name || w.id)}${S.weaponDocs && S.weaponDocs[w.id] && hasPending(S.weaponDocs[w.id].uid) ? ' <span class="pending">●</span>' : ""}</div><div class="s">${esc(w._size || "")} ${esc(w._mountType || "")} · ${esc(w._source)}</div></div></div>`).join("");
}
$("#weapon-list").onclick = (e) => { const it = e.target.closest(".item"); if (it) showWeapon(it.dataset.id); };
["#weapon-search", "#weapon-source", "#weapon-size", "#weapon-type"].forEach((s) => $(s).addEventListener("input", renderWeaponList));
function kvTable(obj) {
  return `<table class="kv">${Object.entries(obj).filter(([k, v]) => !k.startsWith("_") && v !== "" && v != null && k !== "number")
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
}
// ================================================================ WINGS TAB (browser)
function renderWingList() {
  const q = $("#wing-search").value.trim().toLowerCase(), src = $("#wing-source").value;
  const list = S.wings.filter((w) => (!src || w._source === src || !w._source) && matches(q, w.id, w.variant, w._source, w["role desc"])).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  $("#wing-count").textContent = list.length + " wings";
  $("#wing-list").innerHTML = list.map((w) => `
    <div class="item" data-id="${esc(w.id)}">${w._sprite ? `<img loading="lazy" src="${asset(w._sprite)}" alt="">` : '<span class="noimg"></span>'}<div class="t"><div class="n">${esc(w.id)}${S.wingDocs && S.wingDocs[w.id] && hasPending(S.wingDocs[w.id].uid) ? ' <span class="pending">●</span>' : ""}</div>
    <div class="s">${esc(w._hullName ? w._hullName + " × " + (w.num || "?") : "")}${w._hullName ? " · " : ""}${esc(w.role || "")} · ${esc(w["op cost"] || "?")} OP · ${esc(w._source)}</div></div></div>`).join("");
}
$("#wing-list").onclick = (e) => { const it = e.target.closest(".item"); if (it) showWing(it.dataset.id); };
["#wing-search", "#wing-source"].forEach((s) => $(s).addEventListener("input", renderWingList));
// ================================================================ HULLMODS TAB
function renderHullmods() {
  const q = $("#hm-search").value.trim().toLowerCase(), size = $("#hm-size").value, showHidden = $("#hm-hidden").checked, src = $("#hm-source").value;
  const list = S.hullmods.filter((h) => (!src || h._source === src) && (showHidden || !/^true$/i.test(h.hidden || "")) && matches(q, h.name, h.id, h._source, h.tags, h.uiTags))
    .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  $("#hm-count").textContent = list.length + " hullmods";
  $("#hm-grid").innerHTML = list.slice(0, 400).map((h) => `
    <div class="card${typeof HM !== "undefined" && HM && HM.id === h.id ? " selected" : ""}" data-id="${esc(h.id)}" title="Click to edit"><img loading="lazy" src="${asset(h.sprite)}" alt="">
      <div><div><b>${esc(h.name || h.id)}</b> <span class="muted">${esc(h.id)}</span></div>
      <div class="muted" style="font-size:11px">${esc(h._source)} · OP ${esc(h.cost_frigate)}/${esc(h.cost_dest)}/${esc(h.cost_cruiser)}/${esc(h.cost_capital)}${h.uiTags ? " · " + esc(h.uiTags) : ""}</div>
      <div class="desc">${hullmodDescFor(h, size)}</div></div></div>`).join("") +
    (list.length > 400 ? `<div class="muted">…refine search to see more</div>` : "");
}
["#hm-search", "#hm-size", "#hm-hidden", "#hm-source"].forEach((s) => $(s).addEventListener("input", renderHullmods));

// ================================================================ SOURCES TAB
function renderSources() {
  const s = S.summary;
  $("#mods-summary").textContent = `${s.gameDir} · ` + Object.entries(s.counts).map(([k, v]) => `${v} ${k}`).join(" · ");
  $("#warnings").innerHTML = s.warnings.length ? s.warnings.map((w) => `<li>${esc(w)}</li>`).join("") : '<li class="muted">None</li>';
  $("#sources").innerHTML = s.sources.map((x) => `<li>${esc(x.core ? "Starsector (vanilla)" : x.name)}${x.enabled === false ? ' <span class="badge restart">disabled</span>' : ""} <span class="muted">${esc(x.id)} ${esc(x.version)} — ${esc(x.root)}</span>${x.core ? "" : ` <button data-export="${esc(x.id)}" title="Download this mod as a .zip (no .bak backups)" style="padding:1px 8px;font-size:11px">⤓ zip</button>`}</li>`).join("");
}
$("#reload-data").onclick = () => reloadAll();
/** Re-reads everything from disk (after optionally saving new settings). Returns false if the user cancelled. */
async function reloadAll(newSettings) {
  if (CH.entries.size && !confirm(`Reloading discards ${CH.entries.size} pending change(s) and closes all tabs. Continue?`)) return false;
  CH.entries.clear(); CH.previews.clear(); S.shipDocs = {}; S.weaponDocs = {}; S.wingDocs = {}; renderChangesBadge();
  if (typeof IB !== "undefined") IB.data = null;
  if (newSettings) await api("/api/settings", newSettings);
  await api("/api/reload", {});
  S.tabs = []; S.cur = null; switchTab(null);
  W = null; WG = null; $("#weapon-detail").innerHTML = '<p class="muted">Select a weapon.</p>'; $("#wing-detail").innerHTML = '<p class="muted">Select a wing.</p>';
  if (typeof resetToolDocs === "function") resetToolDocs();
  $("#loading").classList.remove("hidden"); $("#loading").textContent = "Loading game data…";
  await boot();
  return true;
}

// start once every script is in (tools.js asks for the Starsector folder when it can't be found)
document.addEventListener("DOMContentLoaded", () => (typeof startup === "function" ? startup() : boot()).catch((e) => { $("#loading").textContent = "Failed to load: " + e.message; }));
