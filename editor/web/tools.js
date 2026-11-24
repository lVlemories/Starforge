// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
/* ============================================================================
 * Extra tools: colour pickers + JSON forms (.wpn visuals, .proj), weapon sounds, factions & fleet roles,
 * "where used", hullmod and ship system editors, mod zip export, tooltips and the guide.
 * Loaded last (after changes.js).
 * ========================================================================== */

// ---------------------------------------------------------------- Changes-list hooks
CH.syncers = CH.syncers || [];
CH.afterDiscard = CH.afterDiscard || [];

// ---------------------------------------------------------------- JSON path helpers
function jget(o, path) { for (const k of path.split(".")) { if (o == null) return undefined; o = o[k]; } return o; }
function jset(o, path, v) {
  const ks = path.split(".");
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  const last = ks[ks.length - 1];
  if (v === undefined) { if (Array.isArray(o)) o[last] = undefined; else delete o[last]; } else o[last] = v;
}
const toHex = (c) => "#" + [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(+((c || [])[i] ?? 255)))).toString(16).padStart(2, "0")).join("");
const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A colour stored as [r,g,b,a] (0-255): swatch + alpha slider + editable numbers. */
function colorHtml(root, path, val) {
  const c = Array.isArray(val) ? val : null, a = c ? (c[3] ?? 255) : 255;
  return `<div class="colf" data-jroot="${esc(root)}" data-jpath="${esc(path)}" data-jk="color">
    <input type="color" value="${toHex(c || [255, 255, 255])}" ${c ? "" : 'class="unset"'} title="Colour">
    <input type="range" min="0" max="255" value="${a}" title="Opacity (alpha): ${a}">
    <input class="coltxt" value="${c ? esc(c.join(", ")) : ""}" placeholder="(not set)" title="r, g, b, a (0-255)">
  </div>`;
}
/**
 * Form for nested JSON. specs: [{p: "a.b", l: "Label", k: num|text|sel|color|sprite|bool|vec2|sound|list, o: [options], h: "help", start: "graphics/..."}].
 * A string in specs starts a sub-heading.
 */
function jformHtml(root, obj, specs) {
  const rows = [];
  for (const s of specs) {
    if (typeof s === "string") { rows.push(`<div class="jf-sub">${esc(s)}</div>`); continue; }
    const v = jget(obj, s.p), id = `data-jroot="${esc(root)}" data-jpath="${esc(s.p)}" data-jk="${s.k || "text"}"`;
    const help = s.h ? ` title="${esc(s.h)}"` : "";
    let input;
    switch (s.k) {
      case "color": input = colorHtml(root, s.p, v); break;
      case "sel": { const o = s.o || [], cur = v == null ? "" : String(v); input = `<select ${id}>${(["", ...o].includes(cur) ? ["", ...o] : [cur, "", ...o]).map((x) => `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(x || "(not set)")}</option>`).join("")}</select>`; break; }
      case "bool": input = `<input type="checkbox" ${id} ${v === true || v === "true" ? "checked" : ""} style="width:auto">`; break;
      case "vec2": input = `<div class="vec2"><input ${id} data-ji="0" value="${esc(Array.isArray(v) ? v[0] ?? "" : "")}"><input ${id} data-ji="1" value="${esc(Array.isArray(v) ? v[1] ?? "" : "")}"></div>`; break;
      case "sprite": input = imgFieldHtml(`<input ${id} value="${esc(v ?? "")}">`, v, s.start || "graphics"); break;
      case "sound": input = `<div class="imgfield"><input ${id} value="${esc(v ?? "")}"><button type="button" class="play-snd" title="Play this sound">▶</button></div>`; break;
      case "list": input = `<input ${id} value="${esc(Array.isArray(v) ? v.join(", ") : v ?? "")}">`; break;
      case "textarea": input = `<textarea ${id} rows="3">${esc(v ?? "")}</textarea>`; break;
      default: input = `<input ${id} value="${esc(v ?? "")}"${s.ro ? " readonly" : ""}>`;
    }
    rows.push(`<label${help} data-help-set="1">${esc(s.l || s.p)}</label>${input}`);
  }
  return `<div class="form jform">${rows.join("")}</div>`;
}
/** getRoot(name) returns the object to edit; onChange(path, rootName) after every edit. */
function bindJform(container, getRoot, onChange) {
  const apply = (el, value) => {
    const o = getRoot(el.dataset.jroot); if (!o) return;
    jset(o, el.dataset.jpath, value);
    onChange && onChange(el.dataset.jpath, el.dataset.jroot);
  };
  container.querySelectorAll("[data-jk]:not(.colf)").forEach((el) => {
    if (el.closest(".colf")) return;
    el.onchange = () => {
      const k = el.dataset.jk; let v;
      if (k === "bool") v = el.checked ? true : undefined;
      else if (k === "num") v = el.value.trim() === "" ? undefined : isFinite(+el.value) ? +el.value : el.value;
      else if (k === "list") v = el.value.trim() ? el.value.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
      else if (k === "vec2") {
        const sib = [...el.parentNode.querySelectorAll("input")].map((x) => x.value.trim());
        v = sib.every((x) => x === "") ? undefined : sib.map((x) => (isFinite(+x) && x !== "" ? +x : 0));
      } else v = el.value === "" ? undefined : el.value;
      apply(el, v);
    };
  });
  container.querySelectorAll(".colf").forEach((w) => {
    const [pick, alpha, txt] = w.querySelectorAll("input");
    const set = (c) => { txt.value = c ? c.join(", ") : ""; if (c) { pick.value = toHex(c); alpha.value = c[3] ?? 255; pick.classList.remove("unset"); } apply(w, c || undefined); };
    pick.oninput = () => set([...fromHex(pick.value), +alpha.value]);
    alpha.oninput = () => { alpha.title = "Opacity (alpha): " + alpha.value; if (txt.value.trim()) set([...fromHex(pick.value), +alpha.value]); };
    txt.onchange = () => {
      const n = txt.value.split(/[ ,]+/).filter(Boolean).map(Number);
      if (!txt.value.trim()) return set(null);
      if (n.length < 3 || n.some((x) => !isFinite(x))) { toast("Colours are 3 or 4 numbers 0-255: r, g, b, a", true); return; }
      set([n[0], n[1], n[2], n[3] ?? 255].map((x) => Math.max(0, Math.min(255, Math.round(x)))));
    };
  });
  container.querySelectorAll(".play-snd").forEach((b) => (b.onclick = () => { const id = b.parentNode.querySelector("input").value.trim(); if (id) playSoundId(id, { report: true }); }));
}

// ---------------------------------------------------------------- weapon visuals + projectile forms
const ANIM_TYPES = ["NONE", "GLOW", "MUZZLE_FLASH", "GLOW_AND_FLASH", "SMOKE"];
const SPAWN_TYPES = ["BALLISTIC", "BALLISTIC_AS_BEAM", "PLASMA", "BEAM"];
const MISSILE_TYPES = ["MISSILE", "MISSILE_TWO", "ROCKET", "HEATSEEKER", "BOMB", "MIRV", "CIRCLE_TARGET", "PHASE_MINE", "NO_AI"];
const COLLISION = ["PROJECTILE_FF", "PROJECTILE_NO_FF", "PROJECTILE_FIGHTER", "RAY", "RAY_FIGHTER", "MISSILE_FF", "MISSILE_NO_FF", "MISSILE_FIGHTER", "NONE"];
function weaponVisualSpecs(w) {
  const out = [
    { p: "glowColor", l: "Glow colour", k: "color", h: "Tint of the glow sprite while charging/firing (and beam glow)." },
    { p: "animationType", l: "Firing animation", k: "sel", o: ANIM_TYPES, h: "GLOW lights the glow sprite; MUZZLE_FLASH emits flash particles; SMOKE emits smoke (missiles)." },
    { p: "visualRecoil", l: "Visual recoil (px)", k: "num", h: "How far the gun sprite kicks back per shot. The gun sprites are only used if this is not 0." },
    { p: "numFrames", l: "Animation frames", k: "num", h: "For animated sprites named …00.png, …01.png etc." },
    { p: "frameRate", l: "Frame rate", k: "num", h: "Frames per second for animated sprites." },
    { p: "alwaysAnimate", l: "Always animate", k: "bool", h: "Animate even when not firing." },
  ];
  const at = w.animationType || "";
  if (/FLASH/.test(at) || w.muzzleFlashSpec) out.push("Muzzle flash",
    { p: "muzzleFlashSpec.length", l: "Length", k: "num", h: "How far the flash particles travel from the barrel (negative = backwards)." },
    { p: "muzzleFlashSpec.spread", l: "Spread (°)", k: "num" },
    { p: "muzzleFlashSpec.particleSizeMin", l: "Particle size min", k: "num" },
    { p: "muzzleFlashSpec.particleSizeRange", l: "Particle size range", k: "num", h: "Added randomly on top of the minimum size." },
    { p: "muzzleFlashSpec.particleDuration", l: "Particle duration (s)", k: "num" },
    { p: "muzzleFlashSpec.particleCount", l: "Particle count", k: "num" },
    { p: "muzzleFlashSpec.particleColor", l: "Particle colour", k: "color" });
  if (at === "SMOKE" || w.smokeSpec) out.push("Smoke",
    { p: "smokeSpec.particleSizeMin", l: "Particle size min", k: "num" },
    { p: "smokeSpec.particleSizeRange", l: "Particle size range", k: "num" },
    { p: "smokeSpec.cloudParticleCount", l: "Cloud particles", k: "num" },
    { p: "smokeSpec.cloudDuration", l: "Cloud duration (s)", k: "num" },
    { p: "smokeSpec.cloudRadius", l: "Cloud radius", k: "num" },
    { p: "smokeSpec.blowbackParticleCount", l: "Blowback particles", k: "num" },
    { p: "smokeSpec.blowbackDuration", l: "Blowback duration (s)", k: "num" },
    { p: "smokeSpec.blowbackLength", l: "Blowback length", k: "num" },
    { p: "smokeSpec.blowbackSpread", l: "Blowback spread (°)", k: "num" },
    { p: "smokeSpec.particleColor", l: "Smoke colour", k: "color" });
  if (w.specClass === "beam") out.push("Beam",
    { p: "fringeColor", l: "Fringe colour", k: "color", h: "Outer colour of the beam." },
    { p: "coreColor", l: "Core colour", k: "color", h: "Inner colour of the beam." },
    { p: "width", l: "Width", k: "num" },
    { p: "textureType", l: "Texture", k: "sel", o: ["ROUGH", "SMOOTH", "LASER", "CHUNKY"], h: "Built-in beam textures (a [fringe, core] list of image paths also works, in the raw JSON)." },
    { p: "textureScrollSpeed", l: "Texture scroll speed", k: "num" },
    { p: "pixelsPerTexel", l: "Pixels per texel", k: "num", h: "Stretches the texture along the beam." },
    { p: "darkCore", l: "Dark core", k: "bool" });
  out.push("Sounds",
    { p: "fireSoundOne", l: "Sound 1 (charge/start)", k: "sound", h: "Sound id from sounds.json. Usually the charge-up (or beam start)." },
    { p: "fireSoundTwo", l: "Sound 2 (fire/loop)", k: "sound", h: "Sound id from sounds.json. The shot, or the loop for beams." });
  return out;
}
function projSpecs(p) {
  if (p.specClass === "missile") {
    const styles = Object.keys(S.styles.engine || {}).filter((k) => !/^\d/.test(k)).sort();
    const custom = jget(p, "engineSlots.0.style") === "CUSTOM";
    return [
      { p: "id", l: "Projectile id", k: "text", ro: true },
      { p: "missileType", l: "Missile type (AI)", k: "sel", o: MISSILE_TYPES },
      { p: "sprite", l: "Sprite", k: "sprite", start: "graphics/missiles" },
      { p: "size", l: "Sprite size (w, h)", k: "vec2" },
      { p: "center", l: "Center (x, y)", k: "vec2", h: "Pivot point in the sprite, in pixels from the bottom-left." },
      { p: "collisionRadius", l: "Collision radius", k: "num" },
      { p: "collisionClass", l: "Collision class", k: "sel", o: COLLISION },
      { p: "explosionColor", l: "Explosion colour", k: "color" },
      { p: "explosionRadius", l: "Explosion radius (visual)", k: "num" },
      { p: "flameoutTime", l: "Flameout time (s)", k: "num" },
      { p: "noEngineGlowTime", l: "No engine glow time (s)", k: "num" },
      { p: "fadeTime", l: "Fade time (s)", k: "num" },
      "Engine (guidance)",
      { p: "engineSpec.acc", l: "Acceleration", k: "num" },
      { p: "engineSpec.dec", l: "Deceleration", k: "num" },
      { p: "engineSpec.turnRate", l: "Turn rate", k: "num" },
      { p: "engineSpec.turnAcc", l: "Turn acceleration", k: "num" },
      "Engine flame (first engine slot)",
      { p: "engineSlots.0.style", l: "Style", k: "sel", o: [...styles, "CUSTOM"] },
      { p: "engineSlots.0.loc", l: "Location (fwd, left)", k: "vec2" },
      { p: "engineSlots.0.width", l: "Flame width", k: "num" },
      { p: "engineSlots.0.length", l: "Flame length", k: "num" },
      { p: "engineSlots.0.angle", l: "Angle", k: "num" },
      ...(custom ? [
        { p: "engineSlots.0.styleSpec.engineColor", l: "Flame colour", k: "color" },
        { p: "engineSlots.0.styleSpec.contrailColor", l: "Contrail colour", k: "color" },
        { p: "engineSlots.0.styleSpec.contrailDuration", l: "Contrail duration", k: "num" },
        { p: "engineSlots.0.styleSpec.contrailWidthMult", l: "Contrail width mult", k: "num" },
        { p: "engineSlots.0.styleSpec.type", l: "Contrail blend", k: "sel", o: ["SMOKE", "GLOW"] },
      ] : []),
    ];
  }
  return [
    { p: "id", l: "Projectile id", k: "text", ro: true },
    { p: "spawnType", l: "Look", k: "sel", o: SPAWN_TYPES, h: "BALLISTIC: shell/streak; BALLISTIC_AS_BEAM: laser bolt; PLASMA: glowing ball." },
    { p: "bulletSprite", l: "Bullet sprite", k: "sprite", start: "graphics/missiles" },
    { p: "length", l: "Length", k: "num" },
    { p: "width", l: "Width", k: "num" },
    { p: "fringeColor", l: "Fringe colour", k: "color" },
    { p: "coreColor", l: "Core colour", k: "color" },
    { p: "glowColor", l: "Glow colour", k: "color" },
    { p: "glowRadius", l: "Glow radius", k: "num" },
    { p: "hitGlowRadius", l: "Hit glow radius", k: "num" },
    { p: "fadeTime", l: "Fade time (s)", k: "num", h: "How long the shot takes to fade after reaching max range." },
    { p: "textureScrollSpeed", l: "Texture scroll speed", k: "num" },
    { p: "pixelsPerTexel", l: "Pixels per texel", k: "num" },
    { p: "collisionClass", l: "Collision class", k: "sel", o: COLLISION },
    { p: "collisionClassByFighter", l: "Collision class (fighters)", k: "sel", o: COLLISION },
    { p: "passThroughMissiles", l: "Passes through missiles", k: "bool" },
    { p: "passThroughFighters", l: "Passes through fighters", k: "bool" },
  ];
}
const PROJ_TEMPLATES = {
  projectile: (id) => ({ id, specClass: "projectile", spawnType: "BALLISTIC", collisionClass: "PROJECTILE_FF", collisionClassByFighter: "PROJECTILE_FIGHTER",
    length: 20, width: 4, fadeTime: 0.2, fringeColor: [255, 200, 120, 255], coreColor: [255, 255, 255, 200], hitGlowRadius: 30, bulletSprite: "graphics/missiles/shell_large_yellow.png" }),
  missile: (id) => ({ id, specClass: "missile", missileType: "MISSILE", sprite: "graphics/missiles/missile_harpoon.png", size: [10, 22], center: [5, 12],
    collisionRadius: 14, collisionClass: "MISSILE_NO_FF", explosionColor: [255, 150, 80, 255], explosionRadius: 100,
    engineSpec: { turnAcc: 200, turnRate: 80, acc: 500, dec: 250 }, engineSlots: [{ id: "ES1", loc: [-12, 0], style: "MISSILE_MIDLINE", width: 6, length: 30, angle: 180 }] }),
};
/** Extra weapon-editor sections (called from renderWeaponEditor). */
function weaponExtraHtml() {
  const p = W.proj, isBeam = W.wpn.specClass === "beam";
  let projHtml = "";
  if (!isBeam) {
    if (p) projHtml = `<h3>Projectile (${esc(W.wpn.projectileSpecId)}.proj)</h3>
      <div class="muted" style="font-size:11px;word-break:break-all">${esc(W.projPath || "new file")} · ${esc(W.projSource || "")}</div>
      ${jformHtml("proj", p, projSpecs(p))}`;
    else if (W.wpn.projectileSpecId) projHtml = `<h3>Projectile</h3><p class="muted">No projectile file “${esc(W.wpn.projectileSpecId)}” was found.</p>
      <div class="btnrow"><button data-newproj="projectile" title="Create ${esc(W.wpn.projectileSpecId)}.proj as a bullet/bolt/plasma shot">Create projectile</button><button data-newproj="missile" title="Create ${esc(W.wpn.projectileSpecId)}.proj as a missile">Create missile</button></div>`;
  }
  return `<h3>Visual effects & sounds (.wpn)</h3>${jformHtml("wpn", W.wpn, weaponVisualSpecs(W.wpn))}${projHtml}`;
}
function bindWeaponExtra() {
  const box = $("#w-extra"); if (!box) return;
  bindJform(box, (r) => (r === "proj" ? W.proj : W.wpn), (path, root) => {
    const raw = $(root === "proj" ? "#proj-raw" : "#wpn-raw"); if (raw) raw.value = JSON.stringify(root === "proj" ? W.proj : W.wpn, null, 2);
    if (path.endsWith("Sprite")) W.imgs = {};
    scheduleSync();
    if (["animationType", "specClass", "engineSlots.0.style"].includes(path)) renderWeaponEditor();
  });
  box.querySelectorAll("[data-newproj]").forEach((b) => (b.onclick = () => {
    W.proj = PROJ_TEMPLATES[b.dataset.newproj](W.wpn.projectileSpecId); W.projPath = null; W.projSource = null; W.projOrig = "null";
    renderWeaponEditor(); scheduleSync();
  }));
}

// ---------------------------------------------------------------- sounds
const SND = { cache: {}, last: {}, loops: {} };
async function soundFiles(id) {
  if (!(id in SND.cache)) SND.cache[id] = await api("/api/sound?id=" + encodeURIComponent(id)).catch(() => null);
  return SND.cache[id];
}
/** Plays a sounds.json id (random variant). opts: {loop, volume, report}. Returns the Audio, or null. */
async function playSoundId(id, opts = {}) {
  const files = await soundFiles(id);
  if (!files || !files.length) { if (opts.report) toast(`No playable sound “${id}” in sounds.json (music archives can't be played).`, true); return null; }
  const f = files[Math.floor(Math.random() * files.length)];
  const a = new Audio(asset(f.file));
  a.volume = Math.max(0, Math.min(1, (+f.volume || 1) * (opts.volume ?? 0.6)));
  a.preservesPitch = false; a.mozPreservesPitch = false; a.playbackRate = Math.max(0.25, Math.min(4, +f.pitch || 1));
  a.loop = !!opts.loop;
  a.play().catch((e) => { if (opts.report) toast("Couldn't play sound: " + e.message, true); });
  return a;
}
/** Called by the firing preview. */
function simSound(kind, sp) {
  if (!SIM.sound) return;
  const id = kind === "charge" ? sp.w.fireSoundOne : sp.w.fireSoundTwo;
  if (!id) return;
  const now = performance.now();
  if (now - (SND.last[kind] || 0) < 70) return; // fast weapons: don't stack hundreds of sounds
  SND.last[kind] = now;
  playSoundId(id, { volume: 0.5 * Math.min(1, SIM.speed * 1.5) });
}
function simBeamSound(sp) {
  const want = SIM.sound && sp.isBeam && SIM.st && SIM.st.beam > 0 && sp.w.fireSoundTwo && !!$("#wsim");
  const cur = SND.loops.beam;
  if (want && !cur) { SND.loops.beam = "starting"; playSoundId(sp.w.fireSoundTwo, { loop: true, volume: 0.45 }).then((a) => { if (SND.loops.beam === "starting") SND.loops.beam = a; else if (a) a.pause(); }); }
  else if (!want && cur) { if (cur.pause) cur.pause(); SND.loops.beam = null; }
  if (want && cur && cur.volume != null) cur.volume = Math.min(1, 0.45 * SIM.st.beam);
}

// ---------------------------------------------------------------- factions & fleet roles
const BP_TAGS = ["base_bp", "lowtech_bp", "midline_bp", "hightech_bp", "rare_bp", "pirate_bp", "LP_bp", "XIV_bp", "heg_aux_bp"];
S.factionDocs = {};
async function ensureFactions(force) {
  if (!S.factions || force) {
    [S.factions, S.roles] = await Promise.all([api("/api/factions"), api("/api/roles")]);
    S.factions.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  }
}
/** The Save-to mod's own copy of a merged JSON file (faction or roles), created on demand. */
async function factionDoc(rel) {
  const t = $("#save-target").value, key = t + "|" + rel;
  if (S.factionDocs[key]) return S.factionDocs[key];
  if (!sourceById(t)) throw new Error("Choose a mod in “Save to mod” (top right) first: faction changes are saved into it.");
  let obj = {}, path = null;
  const f = S.factions.find((x) => x.rel === rel), part = f && f.parts.find((x) => x.source === t);
  if (part) { obj = await api("/api/file?path=" + encodeURIComponent(part.path)); path = part.path; }
  else if (/default_ship_roles\.json$/.test(rel)) {
    const s = sourceById(t), p = s.root.replace(/\\/g, "/") + "/" + rel;
    const existing = await api("/api/file?path=" + encodeURIComponent(p)).catch(() => null);
    if (existing) { obj = existing; path = p; }
  }
  const d = { key, rel, target: t, obj, path, orig: JSON.stringify(obj), uid: newUid("fac") };
  S.factionDocs[key] = d;
  return d;
}
CH.syncers.push(async () => {
  for (const d of Object.values(S.factionDocs)) {
    const k = d.uid;
    if (JSON.stringify(d.obj) === d.orig) { drop(k); continue; }
    const snap = JSON.stringify(d.obj), name = fileName(d.rel);
    const e = jsonEntry(d.target, d.path, d.rel, d.obj, !d.path);
    put(k, Object.assign(e, { owner: "Factions & roles", ownerKey: k, label: `${/roles/.test(d.rel) ? "Fleet roles" : "Faction"} file ${name} (merged with the game's)`,
      onSaved: (r) => { d.path = r.path; d.orig = snap; ensureFactions(true).catch(() => {}); },
      revert: () => { d.obj = JSON.parse(d.orig); } }));
  }
});
const FACTION_KEYS = { hull: ["knownShips", "priorityShips", "hulls"], weapon: ["knownWeapons", "priorityWeapons", "weapons"], wing: ["knownFighters", "priorityFighters", "fighters"], hullmod: ["knownHullMods", null, "hullMods"] };
function knownState(f, kind, id, tags) {
  const [kk, pk, list] = FACTION_KEYS[kind];
  const blk = f[kk] || {}, pblk = (pk && f[pk]) || {};
  const viaTag = (blk.tags || []).find((t) => tags.includes(t));
  return { known: (blk[list] || []).includes(id), viaTag, priority: (pblk[list] || []).includes(id) || (pk && (pblk.tags || []).some((t) => tags.includes(t))) };
}
/** kind: hull | weapon | wing | hullmod. getRow() returns the CSV row whose tags column holds blueprint tags. */
async function openFactionsDialog(kind, id, label, getRow, variantIds) {
  try { await ensureFactions(); } catch (e) { toast("Couldn't load factions: " + e.message, true); return; }
  const row = getRow ? getRow() : null, tags = String((row && row.tags) || "").split(",").map((x) => x.trim()).filter(Boolean);
  const [kk, pk, list] = FACTION_KEYS[kind];
  const pend = (f, key) => { const d = S.factionDocs[$("#save-target").value + "|" + f.rel]; const b = d && jget(d.obj, key + "." + list); return !!(b && b.includes(id)); };
  const rows = S.factions.map((f) => {
    const st = knownState(f, kind, id, tags), pk1 = pend(f, kk), pp = pk && pend(f, pk);
    const known = st.known || !!st.viaTag, lockedK = known && !pk1, lockedP = st.priority && !pp;
    return `<tr data-rel="${esc(f.rel)}" data-name="${esc((f.name || "") + " " + f.id)}">
      <td><span class="swatch" style="background:${f.color ? simRgba(f.color) : "#888"}"></span>${esc(f.name || f.id)} <span class="muted">${esc(f.id)}</span></td>
      <td><input type="checkbox" data-k="known" ${known || pk1 ? "checked" : ""} ${lockedK ? "disabled" : ""}></td>
      ${pk ? `<td><input type="checkbox" data-k="priority" ${st.priority || pp ? "checked" : ""} ${lockedP ? "disabled" : ""}></td>` : ""}
      <td class="muted" style="font-size:11px">${st.viaTag ? `via tag “${esc(st.viaTag)}”` : st.known ? "in faction file" : pk1 ? "pending" : ""}</td></tr>`;
  }).join("");
  const roleNames = Object.keys(S.roles || {}).sort((a, b) => a.localeCompare(b));
  const curRoles = (vid) => roleNames.filter((r) => S.roles[r] && vid in S.roles[r]);
  const pendRoles = (vid) => { const d = S.factionDocs[$("#save-target").value + "|data/world/factions/default_ship_roles.json"]; return d ? Object.keys(d.obj).filter((r) => d.obj[r] && vid in d.obj[r]) : []; };
  const v0 = (variantIds || [])[0] || "";
  const rolesHtml = kind !== "hull" ? "" : `<h3>Fleet roles <span class="muted">(default_ship_roles.json)</span></h3>
    <p class="muted" style="font-size:12px">Fleets are built from <b>variants</b> listed under roles such as combatSmall or carrierMedium. A faction only uses a variant if it also knows the hull.</p>
    ${variantIds && variantIds.length ? `<div class="form"><label>Variant</label><select name="variant">${variantIds.map((v) => `<option>${esc(v)}</option>`).join("")}</select>
      <label title="Relative chance of this variant being picked within the role (vanilla mostly uses 1-10)">Weight</label><input name="weight" value="10"></div>
      <div class="role-grid" id="role-grid"></div>` : '<p class="muted">Save a variant for this hull first (Variant mode), then add it to roles.</p>'}`;
  const bpHtml = row ? `<h3>Blueprint tags <span class="muted">(${kind === "hull" ? "ship_data" : kind === "weapon" ? "weapon_data" : kind === "wing" ? "wing_data" : "hull_mods"}.csv “tags”)</span></h3>
    <p class="muted" style="font-size:12px">Factions with a matching tag in their known list learn it automatically, and these tags decide which blueprint packages it can drop from.</p>
    <div class="tag-grid">${BP_TAGS.map((t) => `<label><input type="checkbox" name="bp" value="${t}" ${tags.includes(t) ? "checked" : ""}> ${t}</label>`).join("")}</div>` : "";
  openDialog(`Factions${kind === "hull" ? " & roles" : ""}: ${label}`, "Apply", `
    <p class="muted" style="font-size:12px">In Starsector something only appears in fleets, markets and blueprints if a faction <b>knows</b> it. Ticks here add “${esc(id)}” to that faction's ${kk} list, saved as a small file in your Save-to mod that the game merges with the faction (nothing in other mods or vanilla is changed). <b>Priority</b> makes fleets prefer it. Greyed boxes are already set elsewhere.</p>
    <input id="fac-search" placeholder="Filter factions…" style="width:100%;margin:6px 0">
    <div style="max-height:300px;overflow:auto"><table class="kv fac-table"><tr><th>Faction</th><th>Known</th>${pk ? "<th>Priority</th>" : ""}<th></th></tr>${rows}</table></div>
    ${rolesHtml}${bpHtml}`, async (root) => {
    // factions
    for (const tr of root.querySelectorAll(".fac-table tr[data-rel]")) {
      const f = S.factions.find((x) => x.rel === tr.dataset.rel);
      for (const cb of tr.querySelectorAll("input[data-k]:not(:disabled)")) {
        const key = cb.dataset.k === "known" ? kk : pk, has = pend(f, key);
        if (cb.checked === has) continue;
        const d = await factionDoc(f.rel);
        const arr = jget(d.obj, key + "." + list) || [];
        if (cb.checked) { jset(d.obj, key + "." + list, arr.concat([id])); if (!jget(d.obj, key + ".tags")) jset(d.obj, key + ".tags", []); }
        else jset(d.obj, key + "." + list, arr.filter((x) => x !== id));
      }
    }
    // roles
    if (kind === "hull" && root.querySelector("#role-grid")) {
      const vid = root.querySelector('[name="variant"]').value, w = +root.querySelector('[name="weight"]').value || 10;
      const want = [...root.querySelectorAll('#role-grid input[data-role]:not(:disabled)')];
      for (const cb of want) {
        const r = cb.dataset.role, has = pendRoles(vid).includes(r);
        if (cb.checked === has) continue;
        const d = await factionDoc("data/world/factions/default_ship_roles.json");
        if (cb.checked) { d.obj[r] = d.obj[r] || {}; d.obj[r][vid] = w; }
        else if (d.obj[r]) { delete d.obj[r][vid]; if (!Object.keys(d.obj[r]).length) delete d.obj[r]; }
      }
    }
    // blueprint tags
    if (row) {
      const chosen = [...root.querySelectorAll('[name="bp"]')].filter((x) => x.checked).map((x) => x.value);
      const keep = tags.filter((t) => !BP_TAGS.includes(t));
      const next = keep.concat(chosen).join(", ");
      if (next !== tags.join(", ")) { row.tags = next; if (kind === "hull" && S.cur) { renderDetail(); } else if (kind === "weapon" && W) renderWeaponEditor(); else if (kind === "wing" && WG) renderWingEditor(); else if (kind === "hullmod" && HM) renderHullmodEditor(); }
    }
    await flushSync();
    toast("Added to the Changes list: review and Save all to write the files.");
  });
  const root = $("#dlg-body");
  root.querySelector("#fac-search").oninput = (e) => { const q = e.target.value.toLowerCase(); root.querySelectorAll(".fac-table tr[data-rel]").forEach((tr) => (tr.style.display = tr.dataset.name.toLowerCase().includes(q) ? "" : "none")); };
  const grid = root.querySelector("#role-grid");
  if (grid) {
    const common = ["combatSmall", "combatMedium", "combatLarge", "combatCapital", "carrierSmall", "carrierMedium", "carrierLarge", "phaseSmall", "phaseMedium", "phaseLarge", "phaseCapital",
      "freighterSmall", "freighterMedium", "freighterLarge", "tankerSmall", "tankerMedium", "tankerLarge", "personnelSmall", "personnelMedium", "personnelLarge",
      "combatFreighterSmall", "combatFreighterMedium", "combatFreighterLarge", "linerSmall", "linerMedium", "linerLarge", "utility", "civilianRandom", "escortSmall", "escortMedium", "fastAttack"];
    const all = [...common.filter((r) => roleNames.includes(r)), ...roleNames.filter((r) => !common.includes(r))];
    const fill = () => {
      const vid = root.querySelector('[name="variant"]').value, cur = curRoles(vid), pr = pendRoles(vid);
      grid.innerHTML = all.map((r) => { const done = cur.includes(r) && !pr.includes(r); return `<label class="${common.includes(r) ? "" : "muted"}" title="${done ? "Already in this role (weight " + esc(S.roles[r][vid]) + ")" : ""}"><input type="checkbox" data-role="${esc(r)}" ${cur.includes(r) || pr.includes(r) ? "checked" : ""} ${done ? "disabled" : ""}> ${esc(r)}</label>`; }).join("");
    };
    root.querySelector('[name="variant"]').onchange = fill; fill();
  }
  void v0;
}

// ---------------------------------------------------------------- where used
const USE_LABEL = { variant: "Variants", "built-in": "Built into hulls", wing: "Fighter wings", hull: "Hulls", skin: "Skins", "module of": "Station module of", faction: "Factions", role: "Fleet roles" };
async function openUsage(kind, id, label) {
  openDialog(`Where is ${label} used?`, "Close", '<p class="muted">Searching every loaded mod…</p>', () => {});
  $("#dlg-cancel").style.display = "none";
  let list;
  try { list = await api(`/api/usage?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`); }
  catch (e) { $("#dlg-body").innerHTML = `<p class="muted">Search failed: ${esc(e.message)}</p>`; return; }
  const groups = {};
  for (const u of list) (groups[u.type] = groups[u.type] || []).push(u);
  const srcName = (sid) => { const s = sid && sourceById(sid); return s ? (s.core ? "Vanilla" : s.name) : ""; };
  $("#dlg-body").innerHTML = !list.length ? `<p>Nothing in the loaded game data refers to <b>${esc(id)}</b>.</p><p class="muted" style="font-size:12px">Scripts (Java code) can still use it; they aren't searched.</p>` :
    `<p class="muted" style="font-size:12px">${list.length} reference${list.length > 1 ? "s" : ""} to <b>${esc(id)}</b>. Click a variant or hull to open it. Java scripts aren't searched.</p>` +
    Object.entries(groups).map(([t, us]) => `<h3>${esc(USE_LABEL[t] || t)} (${us.length})</h3><div class="use-list">${us.sort((a, b) => String(a.id).localeCompare(String(b.id))).map((u) => {
      const hull = u.type === "variant" ? u.label : u.type === "built-in" || u.type === "skin" || u.type === "hull" ? u.id : u.type === "module of" ? u.label : null;
      const open = u.type === "variant" ? `data-open-hull="${esc(kind === "hull" ? id : u.label)}" data-open-variant="${esc(u.id)}"` : hull ? `data-open-hull="${esc(hull)}"` : u.type === "wing" ? `data-open-wing="${esc(u.id)}"` : "";
      return `<div class="use${open ? " link" : ""}" ${open}><b>${esc(u.id)}</b> <span class="muted">${esc(u.type === "variant" && kind !== "hull" ? "on " + u.label : u.label || "")}${u.detail ? " · " + esc(u.detail) : ""}${u.source ? " · " + esc(srcName(u.source)) : ""}</span></div>`;
    }).join("")}</div>`).join("");
  $("#dlg-body").onclick = (e) => {
    const el = e.target.closest(".use.link"); if (!el) return;
    closeDialog(); $("#dlg-cancel").style.display = "";
    if (el.dataset.openWing) { $('#tabs [data-tab="wings"]').click(); showWing(el.dataset.openWing); return; }
    $('#tabs [data-tab="ships"]').click();
    selectHull(el.dataset.openHull, el.dataset.openVariant || undefined);
  };
  const ok = $("#dlg-ok"), prev = ok.onclick; ok.onclick = () => { $("#dlg-cancel").style.display = ""; closeDialog(); void prev; };
}

// ship header actions
ACTIONS.whereUsed = () => openUsage("hull", S.cur.id, tabName(S.cur));
ACTIONS.factions = async () => {
  const c = S.cur;
  const vs = (await api("/api/variants?hull=" + encodeURIComponent(c.id)).catch(() => [])).map((v) => v.variantId);
  if (c.variant && c.variant.variantId && !vs.includes(c.variant.variantId)) vs.unshift(c.variant.variantId);
  else if (c.variant && c.variant.variantId) { vs.splice(vs.indexOf(c.variant.variantId), 1); vs.unshift(c.variant.variantId); }
  openFactionsDialog("hull", c.id, tabName(c), c.isSkin ? null : () => c.csv, vs);
};
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tool]"); if (!b) return;
  const t = b.dataset.tool;
  if (t === "usage-weapon" && W) openUsage("weapon", W.id, W.row.name || W.id);
  if (t === "fac-weapon" && W) openFactionsDialog("weapon", W.id, W.row.name || W.id, () => W.row);
  if (t === "usage-wing" && WG) openUsage("wing", WG.id, WG.id);
  if (t === "fac-wing" && WG) openFactionsDialog("wing", WG.id, WG.id, () => WG.row);
  if (t === "usage-hullmod" && HM) openUsage("hullmod", HM.id, HM.row.name || HM.id);
  if (t === "fac-hullmod" && HM) openFactionsDialog("hullmod", HM.id, HM.row.name || HM.id, () => HM.row);
  if (t === "usage-system" && SY) openUsage("system", SY.id, SY.row.name || SY.id);
  if (t === "files-weapon" && W) openFilesMenu(b, weaponFiles());
  if (t === "files-wing" && WG) openFilesMenu(b, wingFiles());
  if (t === "files-hullmod" && HM) openFilesMenu(b, [{ label: "Stats row (hull_mods.csv)", path: HM.row._file, csv: true }, { label: "Icon", rel: HM.row.sprite }]);
  if (t === "files-system" && SY) openFilesMenu(b, [{ label: "Stats row (ship_systems.csv)", path: SY.row._file, csv: true }, { label: ".system file", path: SY.jsonPath },
    { label: "Description (descriptions.csv)", path: SY.desc && SY.desc._file, csv: true }, { label: "Icon", rel: SY.row.icon }]);
});

// ---------------------------------------------------------------- generic CSV-row document (hullmods, systems)
/** A CSV row (+ optional description and JSON file) edited through the Changes list. */
function rowDocSync(docs, cfg) {
  return async () => {
    for (const d of Object.values(docs)) {
      const owner = `${cfg.what}: ${d.row.name || d.id}${d.isNew ? " (new)" : ""}`;
      const kRow = d.uid + ":row";
      if (d.isNew || JSON.stringify(stripPriv(d.row)) !== d.rowOrig) {
        const e = await csvEntry(cfg.kind, d.row, cfg.rel, ["id"], !!d.isNew, d.isNew ? null : JSON.parse(d.rowOrig));
        put(kRow, Object.assign(e, { owner, ownerKey: d.uid, label: `Row “${d.row.id}” in ${fileName(cfg.rel)}`,
          onSaved: (r) => { d.row._source = r.source; d.row._file = r.path; d.rowOrig = JSON.stringify(stripPriv(d.row)); d.isNew = false; cfg.onSaved && cfg.onSaved(d); },
          revert: () => { const keep = { _source: d.row._source, _file: d.row._file, _template: d.row._template }; d.row = Object.assign(JSON.parse(d.rowOrig || "{}"), keep); } }));
      } else drop(kRow);
      if (cfg.descType) {
        const kD = d.uid + ":desc";
        if (d.desc && (d.isNew || JSON.stringify(d.desc) !== d.descOrig)) {
          const dd = Object.assign({}, d.desc, { id: d.row.id, type: cfg.descType });
          const e = await csvEntry("descriptions", dd, "data/strings/descriptions.csv", ["id", "type"], !!d.isNew || !dd._file, d.descOrig && d.descOrig !== "null" ? JSON.parse(d.descOrig) : null);
          put(kD, Object.assign(e, { owner, ownerKey: d.uid, label: `Description for “${d.row.id}” in descriptions.csv`,
            onSaved: (r) => { d.desc._source = r.source; d.desc._file = r.path; d.descOrig = JSON.stringify(d.desc); },
            revert: () => { d.desc = JSON.parse(d.descOrig || "null"); } }));
        } else drop(kD);
      }
      if (cfg.jsonRel) {
        const kJ = d.uid + ":json";
        if (d.json && JSON.stringify(d.json) !== d.jsonOrig) {
          const snap = JSON.stringify(d.json);
          const e = jsonEntry(d.jsonSource, d.jsonPath, cfg.jsonRel(d), d.json, !d.jsonPath || !!d.isNew);
          put(kJ, Object.assign(e, { owner, ownerKey: d.uid, label: `${cfg.jsonLabel} ${fileName(d.jsonPath || cfg.jsonRel(d))}`,
            onSaved: (r) => { d.jsonPath = r.path; d.jsonSource = r.source; d.jsonOrig = snap; },
            revert: () => { d.json = JSON.parse(d.jsonOrig || "null"); } }));
        } else drop(kJ);
      }
    }
  };
}

// ---------------------------------------------------------------- hullmod editor
let HM = null; S.hullmodDocs = {};
const HM_GROUPS = [
  ["General", ["name", "id", "tier", "rarity", "tech/manufacturer", ["tags", "tags"], ["uiTags", "UI tags (refit filter)"], "base value", "unlocked", "hidden", "hiddenEverywhere", ["sprite", "Icon", "sprite"]]],
  ["OP cost by hull size", [["cost_frigate", "Frigate"], ["cost_dest", "Destroyer"], ["cost_cruiser", "Cruiser"], ["cost_capital", "Capital"]]],
  ["Text (%s = values from the script)", [["desc", "Description", "text"], ["short", "Short description", "text"], ["sModDesc", "S-mod bonus text", "text"]]],
  ["Script", [["script", "Script class"]]],
];
CH.syncers.push(rowDocSync(S.hullmodDocs, { what: "Hullmod", kind: "hullmods", rel: "data/hullmods/hull_mods.csv",
  onSaved: (d) => { const i = S.hullmods.findIndex((h) => h.id === d.id); const row = clone(d.row); if (i >= 0) S.hullmods[i] = row; else S.hullmods.push(row); S.hullmodById[d.id] = row; renderHullmods(); } }));
function showHullmod(id) {
  if (!S.hullmodDocs[id]) {
    const base = S.hullmodById[id]; if (!base) return;
    S.hullmodDocs[id] = { id, row: clone(base), rowOrig: JSON.stringify(stripPriv(base)), uid: newUid("hm") };
  }
  HM = S.hullmodDocs[id];
  document.querySelectorAll("#hm-grid .card").forEach((x) => x.classList.toggle("selected", x.dataset.id === id));
  renderHullmodEditor();
}
function renderHullmodEditor() {
  const el = $("#hm-detail"); if (!el || !HM) return;
  const r = HM.row, dirty = HM.isNew || JSON.stringify(stripPriv(r)) !== HM.rowOrig;
  el.innerHTML = `<div class="ed-head"><div><h2>${esc(r.name || HM.id)}${HM.isNew ? ' <span class="badge live">new</span>' : ""}</h2>
      <div class="muted">${esc(HM.id)} · from ${esc(r._source || "(new)")}</div></div></div>
    <div class="btnrow"><button data-tool="files-hullmod" title="Open hull_mods.csv or the icon, or show them in their folder">📂 Files</button><button data-tool="usage-hullmod" title="Find variants and hulls that use this hullmod">Where used</button>
      <button data-tool="fac-hullmod" title="Let factions know (sell/use) this hullmod">Factions…</button>
      <button id="hm-dup" title="Copy this hullmod under a new id (it keeps the same script class)">Duplicate…</button>
      <button id="hm-revert" ${dirty ? "" : "disabled"}>Revert</button></div>
    <div id="hm-pending">${pendingLine(HM.uid)}</div>
    <div class="card" style="margin:8px 0"><img src="${asset(r.sprite)}" alt=""><div><b>${esc(r.name || "")}</b><div class="desc">${hullmodDescFor(r, $("#hm-size").value)}</div></div></div>
    ${csvGroups(r, HM_GROUPS)}
    <p class="muted" style="font-size:12px">The effect itself comes from the script class (Java); a duplicate behaves like the original until you write a new script.</p>`;
  bindCsv(el, r, (col) => { if (["name", "desc", "sprite"].includes(col)) { const c = el.querySelector(".card"); if (c) c.innerHTML = `<img src="${asset(r.sprite)}" alt=""><div><b>${esc(r.name || "")}</b><div class="desc">${hullmodDescFor(r, $("#hm-size").value)}</div></div>`; } });
  bindReview(el);
  $("#hm-revert").onclick = () => { for (const k of [...CH.entries.keys()]) if (CH.entries.get(k).ownerKey === HM.uid) discardEntry(k); };
  $("#hm-dup").onclick = () => openDialog("Duplicate hullmod", "Duplicate", `<div class="form"><label>New id</label><input name="id" value="${esc(HM.id)}_copy"><label>Name</label><input name="name" value="${esc(r.name || "")} (copy)"></div>`, (root) => {
    const id = dv(root, "id"); if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("Ids may only use letters, digits, _ - and ."); if (S.hullmodById[id] || S.hullmodDocs[id]) throw new Error(`“${id}” already exists.`);
    const row = Object.assign(clone(r), { id, name: dv(root, "name") || id, _source: null, _file: null, _template: r._file || r._template });
    S.hullmodDocs[id] = { id, row, rowOrig: "", isNew: true, uid: newUid("hm") };
    showHullmod(id); scheduleSync();
  });
}
function markHullmodPending() { const p = $("#hm-pending"); if (p && HM) { p.innerHTML = pendingLine(HM.uid); bindReview(p); } }
CH.afterDiscard.push(() => {
  for (const [id, d] of Object.entries(S.hullmodDocs)) if (d.isNew && ![...CH.entries.values()].some((x) => x.ownerKey === d.uid)) { delete S.hullmodDocs[id]; if (HM === d) { HM = null; $("#hm-detail").innerHTML = '<p class="muted">Select a hullmod.</p>'; } }
  if (HM) renderHullmodEditor();
  if (SY) renderSystemEditor();
});
$("#hm-grid").addEventListener("click", (e) => { const c = e.target.closest(".card[data-id]"); if (c) showHullmod(c.dataset.id); });

// ---------------------------------------------------------------- ship system editor
let SY = null; S.systemDocs = {}; S.systems = null;
const SYS_GROUPS = [
  ["General", ["name", "id", ["tags", "tags"], ["icon", "Icon", "sprite"]]],
  ["Flux & uses", [["flux/second", "Flux / second (while active)"], "f/s (base rate)", "f/s (base cap)", ["flux/use", "Flux per use"], "f/u (base rate)", "f/u (base cap)", ["cr/u", "CR per use"], ["max uses", "Max uses (charges)"], ["regen", "Charge regen / second"]]],
  ["Timing (seconds)", [["charge up", "Charge up"], ["active", "Active"], ["down", "Charge down"], ["cooldown", "Cooldown"], ["toggle", "Toggle (TRUE/blank)"]]],
  ["While active", ["noDissipation", "noHardDissipation", "hardFlux", "noFiring", "noTurning", "noStrafing", "noAccel", "noShield", "noVent", "isPhaseCloak"]],
];
const SYS_SPECS = [
  { p: "id", l: "Id", k: "text", ro: true }, { p: "type", l: "Type", k: "text", h: "e.g. STAT_MOD, ENGINE_MOD, PHASE_CLOAK, DRONE_LAUNCHER, EMP_EMITTER…" },
  { p: "aiType", l: "AI type", k: "text", h: "How the AI decides to use it; e.g. BURN_DRIVE_TOGGLE, MANEUVERING_JETS, CUSTOM (needs aiScript)." },
  { p: "statsScript", l: "Stats script", k: "text" }, { p: "aiScript", l: "AI script", k: "text" },
  "Sounds", { p: "useSound", l: "Use sound", k: "sound" }, { p: "loopSound", l: "Loop sound", k: "sound" }, { p: "deactivateSound", l: "Deactivate sound", k: "sound" }, { p: "outOfUsesSound", l: "Out of uses sound", k: "sound" },
  "Engine glow (engine systems)", { p: "engineGlowColor", l: "Engine glow colour", k: "color" }, { p: "engineGlowContrailColor", l: "Contrail colour", k: "color" },
  { p: "engineGlowLengthMult", l: "Glow length mult", k: "num" }, { p: "engineGlowWidthMult", l: "Glow width mult", k: "num" }, { p: "engineGlowGlowMult", l: "Glow mult", k: "num" },
  "Weapon glow (weapon systems)", { p: "weaponGlowColor", l: "Weapon glow colour", k: "color" }, { p: "jitterColor", l: "Jitter colour", k: "color" }, { p: "jitterUnderColor", l: "Jitter under colour", k: "color" },
];
CH.syncers.push(rowDocSync(S.systemDocs, { what: "Ship system", kind: "systems", rel: "data/shipsystems/ship_systems.csv", descType: "SHIP_SYSTEM",
  jsonRel: (d) => "data/shipsystems/" + d.row.id + ".system", jsonLabel: "System file",
  onSaved: (d) => { const i = S.systems.findIndex((x) => x.id === d.id); const row = clone(d.row); if (i >= 0) S.systems[i] = row; else S.systems.push(row); renderSystemList(); } }));
async function ensureSystems() {
  if (S.systems) return;
  S.systems = await api("/api/systems");
  fillSourceFilter($("#sys-source"), S.systems.map((x) => x._source), "systems");
  renderSystemList();
}
function renderSystemList() {
  if (!S.systems) return;
  const q = $("#sys-search").value.trim().toLowerCase(), src = $("#sys-source").value;
  const list = S.systems.concat(Object.values(S.systemDocs).filter((d) => d.isNew).map((d) => d.row))
    .filter((x) => (!src || x._source === src || !x._source) && matches(q, x.name, x.id, x._source, x.tags)).sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  $("#sys-count").textContent = list.length + " ship systems";
  $("#sys-list").innerHTML = list.slice(0, 800).map((x) => `<div class="item${SY && SY.id === x.id ? " selected" : ""}" data-id="${esc(x.id)}"><img loading="lazy" src="${asset(x.icon)}" alt="">
    <div class="t"><div class="n">${esc(x.name || x.id)}${S.systemDocs[x.id] && hasPending(S.systemDocs[x.id].uid) ? ' <span class="pending">●</span>' : ""}</div><div class="s">${esc(x.id)} · ${esc(x._source || "(new)")}</div></div></div>`).join("");
}
async function showSystem(id) {
  if (!S.systemDocs[id]) {
    const base = S.systems.find((x) => x.id === id); if (!base) return;
    const [desc, file] = await Promise.all([api(`/api/description?type=SHIP_SYSTEM&id=${encodeURIComponent(id)}`).catch(() => null), api("/api/systemfile?id=" + encodeURIComponent(id)).catch(() => null)]);
    S.systemDocs[id] = { id, row: clone(base), rowOrig: JSON.stringify(stripPriv(base)), uid: newUid("sys"), desc, descOrig: JSON.stringify(desc),
      json: file ? file.json : null, jsonOrig: JSON.stringify(file ? file.json : null), jsonPath: file && file.path, jsonSource: file && file.source };
  }
  SY = S.systemDocs[id];
  renderSystemList(); renderSystemEditor();
}
function renderSystemEditor() {
  const el = $("#sys-detail"); if (!el || !SY) return;
  const r = SY.row, dirty = hasPending(SY.uid);
  el.innerHTML = `<div class="ed-head"><div><h2>${esc(r.name || SY.id)}${SY.isNew ? ' <span class="badge live">new</span>' : ""}</h2>
      <div class="muted">${esc(SY.id)} · CSV from ${esc(r._source || "(new)")} · .system from ${esc(SY.jsonSource || "—")}</div></div>
      <div class="btnrow" style="margin:0"><button data-tool="files-system" title="Open this system's files or show them in their folder">📂 Files</button><button data-tool="usage-system" title="Find hulls that use this system">Where used</button>
      <button id="sy-dup">Duplicate as new system…</button><button id="sy-revert" ${dirty ? "" : "disabled"}>Revert</button></div></div>
    <div id="sy-pending">${pendingLine(SY.uid)}</div>
    <div class="ed-cols"><div class="ed-col">
      ${csvGroups(r, SYS_GROUPS)}
      <h3>Description</h3><textarea id="sy-desc" rows="5" style="width:100%">${esc((SY.desc && SY.desc.text1) || "")}</textarea>
    </div><div class="ed-col">
      ${SY.json ? `<h3>System file (${esc(fileName(SY.jsonPath || r.id + ".system"))})</h3>${jformHtml("sys", SY.json, SYS_SPECS)}
        <details style="margin-top:8px"><summary class="muted">Raw .system JSON (everything else)</summary>
        <textarea id="sy-raw" rows="16" style="width:100%;font-family:monospace;font-size:12px">${esc(JSON.stringify(SY.json, null, 2))}</textarea>
        <div class="btnrow"><button id="sy-raw-apply">Apply JSON</button></div></details>` : '<p class="muted">No .system file found for this id.</p>'}
      <p class="muted" style="font-size:12px">What the system does comes from its stats/AI scripts (Java). These files control numbers, sounds and visuals.</p>
    </div></div>`;
  bindCsv(el, r, () => {});
  bindJform(el, () => SY.json, () => { const raw = $("#sy-raw"); if (raw) raw.value = JSON.stringify(SY.json, null, 2); scheduleSync(); });
  $("#sy-desc").oninput = () => { SY.desc = SY.desc || { id: SY.id, type: "SHIP_SYSTEM", text1: "", _source: null }; SY.desc.text1 = $("#sy-desc").value; scheduleSync(); };
  if ($("#sy-raw-apply")) $("#sy-raw-apply").onclick = () => { try { SY.json = JSON.parse($("#sy-raw").value); renderSystemEditor(); scheduleSync(); } catch (e) { toast("Invalid JSON: " + e.message, true); } };
  bindReview(el);
  $("#sy-revert").onclick = () => { for (const k of [...CH.entries.keys()]) if (CH.entries.get(k).ownerKey === SY.uid) discardEntry(k); };
  $("#sy-dup").onclick = () => openDialog("Duplicate ship system", "Duplicate", `<div class="form"><label>New id</label><input name="id" value="${esc(SY.id)}_copy"><label>Name</label><input name="name" value="${esc(r.name || "")} (copy)"></div>`, (root) => {
    const id = dv(root, "id"); if (!/^[A-Za-z0-9_\-.]+$/.test(id)) throw new Error("Ids may only use letters, digits, _ - and ."); if (S.systems.some((x) => x.id === id) || S.systemDocs[id]) throw new Error(`“${id}” already exists.`);
    const src = SY;
    S.systemDocs[id] = { id, row: Object.assign(clone(r), { id, name: dv(root, "name") || id, _source: null, _file: null, _template: r._file || r._template }), rowOrig: "", isNew: true, uid: newUid("sys"),
      desc: src.desc ? Object.assign(clone(src.desc), { id, _file: null, _source: null }) : { id, type: "SHIP_SYSTEM", text1: "" }, descOrig: "null",
      json: src.json ? Object.assign(clone(src.json), { id }) : null, jsonOrig: "null", jsonPath: null, jsonSource: null };
    showSystem(id); scheduleSync();
  });
}
function markSystemPending() { const p = $("#sy-pending"); if (p && SY) { p.innerHTML = pendingLine(SY.uid); bindReview(p); } }
$("#sys-list").addEventListener("click", (e) => { const it = e.target.closest(".item"); if (it) showSystem(it.dataset.id); });
["#sys-search", "#sys-source"].forEach((s) => $(s).addEventListener("input", renderSystemList));
$('#tabs [data-tab="systems"]').addEventListener("click", () => ensureSystems().catch((e) => toast("Couldn't load ship systems: " + e.message, true)));
// keep pending markers fresh after each sync
CH.syncers.push(async () => { setTimeout(() => { markHullmodPending(); markSystemPending(); }, 0); });

// ---------------------------------------------------------------- mod export
function exportModZip(id) {
  const s = sourceById(id); if (!s || s.core) { toast("Choose a mod to export.", true); return; }
  const pending = [...CH.entries.values()].filter((e) => e.dest && e.dest.id === id).length;
  if (pending && !confirm(`${pending} pending change(s) for ${s.name} aren't saved yet and won't be in the zip. Export anyway?`)) return;
  if (window.FORGE_LOCAL) {
    toast(`Exporting ${s.name}…`);
    FORGE_LOCAL.exportMod(id).then((z) => toast(`Exported ${z.name} (${Math.round(z.blob.size / 1024).toLocaleString()} KB) to your downloads.`), (e) => toast("Export failed: " + e.message, true));
    return;
  }
  const a = document.createElement("a"); a.href = "/api/exportmod?id=" + encodeURIComponent(id); a.download = ""; document.body.appendChild(a); a.click(); a.remove();
  toast(`Exporting ${s.name}… (old .bak files are left out)`);
}
$("#export-mod").onclick = () => exportModZip($("#save-target").value);
$("#sources").addEventListener("click", (e) => { const b = e.target.closest("[data-export]"); if (b) exportModZip(b.dataset.export); });

// ================================================================ HELP: tooltips + guide
const FIELD_HELP = {
  // ship_data.csv
  "hitpoints": "Hull points. When they reach 0 the ship is destroyed.", "armor rating": "Armor per cell. Reduces incoming damage, and is itself worn down by hits.",
  "max flux": "Flux capacity. Firing and shields add flux; at maximum the ship overloads.", "8/6/5/4%": "Unused legacy column.", "flux dissipation": "Flux removed per second (more while venting).",
  "ordnance points": "OP budget for weapons, hullmods, vents/caps and fighters.", "fighter bays": "Number of fighter wings the ship carries.", "max speed": "Top speed (units/second).",
  "acceleration": "Speed gained per second.", "deceleration": "Speed lost per second when braking.", "max turn rate": "Degrees per second.", "turn acceleration": "Degrees per second² of turning acceleration.",
  "mass": "Affects collisions, knockback and how hard the ship is to push.", "shield type": "NONE, FRONT, OMNI or PHASE.", "defense id": "Id of the shield/phase system (e.g. phasecloak).",
  "shield arc": "Shield coverage in degrees.", "shield upkeep": "Flux/second while the shield is up (fraction of dissipation in game terms).", "shield efficiency": "Flux generated per point of damage blocked (lower is better).",
  "phase cost": "Flux to activate phase.", "phase upkeep": "Flux/second while phased.", "min crew": "Crew needed to operate.", "max crew": "Crew capacity.", "cargo": "Cargo capacity.", "fuel": "Fuel capacity.",
  "fuel/ly": "Fuel used per light-year.", "range": "Weapon range in units (1 unit = 1 sprite pixel).", "max burn": "Speed on the campaign map.", "base value": "Price in credits before markups.",
  "cr %/day": "Combat readiness recovered per day.", "CR to deploy": "Combat readiness spent when deploying.", "peak CR sec": "Seconds of peak performance before CR starts dropping in combat.",
  "CR loss/sec": "CR lost per second after peak time.", "supplies/rec": "Supplies to recover (deploy cost).", "supplies/mo": "Monthly maintenance in supplies.", "c/s": "Unused.",
  "c/f": "Unused.", "f/s": "Unused.", "f/f": "Unused.", "crew/s": "Unused.", "crew/f": "Unused.", "hints": "Comma list of hints: CARRIER, CIVILIAN, PHASE, STATION, MODULE, UNBOARDABLE, HIDE_IN_CODEX…",
  "tags": "Comma list of tags. Blueprint tags (rare_bp, midline_bp…) and faction tags control who knows and sells it.", "rarity": "0-1, how often it shows up in markets/salvage (blank = 1).",
  "breakProb": "Chance the wreck breaks apart.", "minPieces": "Minimum debris pieces.", "maxPieces": "Maximum debris pieces.", "travel drive": "Campaign travel drive system id.",
  "number": "Order in some lists.", "designation": "Ship class label shown in game (Frigate, Battlecruiser, Carrier…).", "tech/manufacturer": "Design type shown in game (Low Tech, Midline, High Tech…).",
  "system id": "Ship system id (see the Systems tab).", "fleet pts": "Fleet points: strength used for fleet size limits and AI.", "logistics n/a reason": "Text shown if the ship can't be used for logistics.",
  // weapon_data.csv
  "damage/shot": "Damage per projectile.", "damage/second": "Beam damage per second.", "emp": "EMP damage (disables weapons/engines).", "impact": "Knockback strength.", "turn rate": "How fast the turret turns (degrees/second).",
  "OPs": "Ordnance point cost.", "ammo": "Ammo capacity (blank = unlimited).", "ammo/sec": "Ammo regenerated per second.", "reload size": "Ammo added per reload tick.", "type": "Damage type: KINETIC, HIGH_EXPLOSIVE, ENERGY, FRAGMENTATION.",
  "energy/shot": "Flux per shot.", "energy/second": "Flux per second (beams).", "chargeup": "Seconds before the first shot of a burst.", "chargedown": "Cooldown after a burst (refire delay).",
  "burst size": "Shots per burst. For beams: how many seconds a burst beam fires.", "burst delay": "Seconds between shots in a burst. For burst beams: the cooldown.", "min spread": "Inaccuracy (degrees) when fresh.",
  "max spread": "Maximum inaccuracy.", "spread/shot": "Inaccuracy added per shot.", "spread decay/sec": "How fast inaccuracy recovers.", "beam speed": "How fast the beam extends.",
  "proj speed": "Projectile speed (max speed for missiles).", "launch speed": "Missile speed when launched.", "flight time": "Missile lifetime in seconds.", "proj hitpoints": "Hit points of missiles (for point defense).",
  "autofireAccBonus": "Accuracy bonus for autofire.", "extraArcForAI": "Extra arc the AI uses to decide to fire.", "groupTag": "Weapons with the same group tag are interchangeable in autofit.",
  "primaryRoleStr": "Role text in the tooltip.", "speedStr": "Speed text in the tooltip.", "trackingStr": "Tracking text in the tooltip.", "turnRateStr": "Turn rate text in the tooltip.", "accuracyStr": "Accuracy text in the tooltip.",
  "customPrimary": "Custom tooltip line (%s placeholders).", "customPrimaryHL": "Values highlighted in customPrimary.", "customAncillary": "Extra tooltip text.", "customAncillaryHL": "Highlighted values for customAncillary.",
  "noDPSInTooltip": "TRUE hides DPS in the tooltip.", "tier": "Tech tier (0-3) for drops and markets.", "for weapon tooltip>>": "Separator column (ignored).",
  // wing_data.csv
  "variant": "Fighter variant id used by each fighter.", "num": "Fighters per wing.", "op cost": "Ordnance point cost of the wing.", "refit": "Seconds to replace a lost fighter.",
  "formation": "Formation shape (V, CLAW, BOX…).", "role": "FIGHTER, BOMBER, INTERCEPTOR, SUPPORT.", "role desc": "Role text shown in game.", "attackRunRange": "How close bombers get before releasing.",
  "attackPositionOffset": "Offset of the attack position.",
  // .ship
  "center": "Ship center in the sprite, pixels from the bottom-left. All other points are relative to it.", "collisionRadius": "Radius used for broad collision checks.",
  "shieldCenter": "Shield center relative to the ship center.", "shieldRadius": "Shield radius.", "viewOffset": "Camera offset in the refit screen.", "style": "Hull style (engine/shield look).",
  "width": "Sprite width in pixels.", "height": "Sprite height in pixels.", "spriteName": "Path of the ship sprite.", "hullSize": "FIGHTER, FRIGATE, DESTROYER, CRUISER or CAPITAL_SHIP.",
  "moduleAnchor": "For station modules: the point attached to the parent ship's module slot.",
  // slots/engines (popup)
  "angle": "Facing in degrees (0 = forward, positive = left).", "arc": "Firing arc in degrees.", "mount": "TURRET (rotates), HARDPOINT (fixed, more accurate) or HIDDEN (not drawn).",
  "size": "SMALL, MEDIUM or LARGE.", "renderOrderMod": "Drawing order relative to other weapons.", "contrailSize": "Contrail width.", "length": "Flame length.",
  // .wpn
  "specClass": "projectile, beam or missile-launching projectile weapon.", "barrelMode": "ALTERNATING, LINKED (all barrels together) or ALTERNATING_BURST.", "turretSprite": "Turret base sprite.",
  "turretUnderSprite": "Drawn under the turret base.", "turretGunSprite": "Recoiling barrel sprite (needs visualRecoil).", "turretGlowSprite": "Glow overlay tinted with glowColor.",
  "hardpointSprite": "Hardpoint base sprite.", "hardpointUnderSprite": "Drawn under the hardpoint.", "hardpointGunSprite": "Recoiling barrel (hardpoint).", "hardpointGlowSprite": "Glow overlay (hardpoint).",
  "projectileSpecId": "Id of the .proj file this weapon fires.", "fireSoundOne": "Charge/start sound id.", "fireSoundTwo": "Fire or loop sound id.", "renderHints": "e.g. RENDER_BARREL_BELOW, RENDER_LOADED_MISSILES.",
  // hull_mods.csv
  "cost_frigate": "OP cost on frigates.", "cost_dest": "OP cost on destroyers.", "cost_cruiser": "OP cost on cruisers.", "cost_capital": "OP cost on capitals.", "script": "Java class implementing the effect.",
  "desc": "Description; %s is replaced by values from the script.", "short": "One-line description.", "sModDesc": "Extra text when built in as an S-mod.", "unlocked": "TRUE = known from the start.",
  "hidden": "TRUE hides it from the refit list.", "hiddenEverywhere": "TRUE hides it everywhere.", "uiTags": "Refit screen filter categories.", "sprite": "Icon image.",
  // ship_systems.csv
  "flux/second": "Flux per second while active.", "flux/use": "Flux per activation.", "cr/u": "CR per activation.", "max uses": "Charges (blank = unlimited).", "regen": "Charges regained per second.",
  "charge up": "Seconds to activate.", "active": "Seconds fully active.", "down": "Seconds to wind down.", "cooldown": "Seconds before it can be used again.", "toggle": "TRUE = on/off system.",
  "noDissipation": "No flux dissipation while active.", "noHardDissipation": "No hard flux dissipation.", "hardFlux": "Flux generated is hard flux.", "noFiring": "Can't fire while active.",
  "noTurning": "Can't turn.", "noStrafing": "Can't strafe.", "noAccel": "Can't accelerate.", "noShield": "Shield down while active.", "noVent": "Can't vent.", "isPhaseCloak": "Counts as a phase cloak.", "icon": "System icon image.",
};
const BUTTON_HELP = {
  view: "View mode: stats, description, checks and hull settings (key 1)", variant: "Variant mode: fit weapons, hullmods, wings, vents and capacitors (key 2)",
  slots: "Slots mode: add, move, aim and edit weapon slots (key 3)", engines: "Engines mode: add and edit engine flames (key 4)",
  bounds: "Bounds mode: collision outline; Generate bounds traces the sprite (key 5)", centers: "Centers mode: ship center, shield and collision radius, module anchor (key 6)",
};
function helpFor(el) {
  const raw = el.dataset.csv || el.dataset.wpn || el.dataset.bind || el.dataset.jpath; if (!raw) return null;
  if (FIELD_HELP[raw]) return FIELD_HELP[raw];
  const last = raw.split(".").filter((x) => !/^\d+$/.test(x)).pop();
  return FIELD_HELP[last] || null;
}
function applyHelp(root) {
  root.querySelectorAll("[data-csv],[data-wpn],[data-bind],[data-jpath]").forEach((el) => {
    if (el.dataset.helped) return; el.dataset.helped = 1;
    const h = helpFor(el); if (!h) return;
    if (!el.title) el.title = h;
    // label before the field (forms) or the first cell of the row (tables)
    const td = el.closest("td"), lab = td ? td.previousElementSibling : (el.closest(".imgfield,.vec2,.colf") || el).previousElementSibling;
    if (lab && (lab.tagName === "LABEL" || lab.tagName === "TD") && !lab.dataset.helpSet) { lab.title = h + (lab.title && lab.title !== h ? `\n(${lab.title})` : ""); lab.classList.add("has-help"); lab.dataset.helpSet = 1; }
  });
  root.querySelectorAll("#modes [data-mode]").forEach((b) => { if (BUTTON_HELP[b.dataset.mode]) b.title = BUTTON_HELP[b.dataset.mode]; });
}
let helpTimer = null;
new MutationObserver(() => { clearTimeout(helpTimer); helpTimer = setTimeout(() => applyHelp(document.body), 60); }).observe(document.body, { childList: true, subtree: true });
applyHelp(document.body);

const GUIDE = [
  ["Quick start", `<ol>
    <li>Pick <b>Save to mod</b> (top right). Anything from vanilla, and anything new, is saved into that mod. Don't have one? Click <b>New mod…</b> above the hull list.</li>
    <li>Choose a hull on the left. It opens in a tab; edit it with the modes along the top (keys 1-6).</li>
    <li>Nothing is written while you edit. Every change appears in <b>Changes</b>; open it (or press Ctrl+S) to see exactly which files change, then <b>Save all</b>.</li>
    <li>Restart Starsector to see your changes in game (the game reads its data at startup).</li></ol>`],
  ["Editing ships", `<ul>
    <li><b>View</b>: ship_data.csv stats, description, hints, skin overrides and the <b>checks</b> button (warnings about mistakes; click one to jump to it).</li>
    <li><b>Variant</b>: click a slot to see its weapon, click again to change it. Hullmods, S-mods, built-ins, wings, vents/caps, weapon groups and station modules are in the right panel.</li>
    <li><b>Slots</b>: click a slot to edit it in a popup. Drag to move, Alt+drag to aim, Shift+click to add, Del to delete. <b>Mirror</b> edits left/right pairs together.</li>
    <li><b>Engines</b>: same controls; Ctrl+drag resizes the flame. <b>Bounds</b>: drag points or click <b>Generate bounds</b>. <b>Centers</b>: drag the ship/shield center.</li>
    <li><b>Multi-part ships</b>: station modules are drawn on their parent with their own weapons and flames; open a module and its parent ship (and the other modules) is drawn around it. <b>Attached</b> (toolbar) switches these between Visible, Transparent and Hidden. In View or Variant mode, click an attached part to open it.</li>
    <li>Mouse wheel zooms, right/middle drag pans. Ctrl+Z / Ctrl+Y undo and redo.</li>
    <li>Tabs: middle-click closes one; right-click a tab for Close others, Close tabs to the right and Close all. Unsaved edits stay in Changes.</li></ul>`],
  ["New ships, skins and mods", `<ul>
    <li><b>New hull…</b>: give it an id and a sprite (pick one with Browse… or upload a PNG). Then Generate bounds, add slots and engines, and set stats.</li>
    <li><b>Duplicate hull…</b> copies an existing ship; <b>New skin…</b> makes a .skin that only stores differences from its base hull.</li>
    <li><b>Getting it into the game</b>: open the ship's <b>Factions & roles…</b>. Tick the factions that should know it, add a saved variant to fleet roles (e.g. combatMedium), and pick blueprint tags. Without this a new ship only exists in the codex/console.</li></ul>`],
  ["Weapons, fighters, hullmods, systems", `<ul>
    <li><b>Weapons</b>: CSV stats with live DPS, the .wpn file (sprites with Browse…, fire points you can drag, visual effects with colour pickers, sounds with ▶) and the projectile/missile.</li>
    <li>The <b>Firing preview</b> (collapsed at the top) shows an approximation of the weapon firing. Use it to check sprites and animation, not exact in-game behaviour.</li>
    <li><b>Strike craft</b>: wing_data.csv plus the fighter hull's stats; “Edit fighter geometry & loadout” opens the fighter in the Ships tab.</li>
    <li><b>Hullmods</b> and <b>Systems</b>: click one to edit its CSV row, text and files. Their actual effect is Java code, so a duplicate behaves like the original.</li>
    <li><b>Where used</b> finds every variant, hull, wing and faction that refers to the thing you're editing.</li></ul>`],
  ["Saving, backups and sharing", `<ul>
    <li>Files already in a mod are updated in place. Before every <b>Save all</b>, each file it changes is copied to <code>Starforge/backups/&lt;date_time&gt;/</code>; <b>Backups…</b> (in Changes or the Sources tab) restores any earlier save. Vanilla is never modified: edited copies go to your Save-to mod.</li>
    <li>CSV saves replace or add only the edited row; every other line stays untouched.</li>
    <li>Faction and role changes are saved as small files in your Save-to mod; the game merges them with the original faction.</li>
    <li><b>⤓ Export</b> (next to Save to mod) downloads your mod as a .zip, ready to share.</li></ul>`],
  ["Tips", `<ul>
    <li>Hover over a field name to see what it does (fields with help have a dotted underline).</li>
    <li><b>☰ Mods</b> chooses which mods the editor loads: the game launcher's selection, everything, or exactly the mods you tick (including which version, when you have duplicates). Fewer mods load faster.</li>
    <li>The Sources tab lists every loaded mod and any loading warnings (for example two versions of the same mod installed).</li>
    <li>Hullmod numbers (%s) need the optional <b>Starforge Data Export</b> mod: enable it and launch the game once.</li>
    <li>Colours: ⚙ Colours changes the editor's own colours (arcs, slots, bounds…).</li></ul>`],
  ["About & licence", `<p><b>Starforge</b>. Copyright © 2026 Claude.</p>
    <p>This program is free software: you can redistribute it and/or modify it under the terms of the
    <b>GNU General Public License</b> as published by the Free Software Foundation, either version 3 of the License, or (at your option)
    any later version.</p>
    <p>It is distributed in the hope that it will be useful, but <b>WITHOUT ANY WARRANTY</b>; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. The full licence is in the <code>LICENSE</code> file that comes with the editor.</p>
    <p>The complete source code is published on GitHub in the Starforge repository, alongside the downloads.</p>
    <h3>Credits</h3><ul>
    <li>Engine flame textures from <b>Ship-Editor</b> by Ontheheavens (public domain, Unlicense), whose engine and slot editing also inspired parts of this editor.</li>
    <li>Inspired by <b>Daedalus Forge</b>.</li>
    <li>Starsector is © Fractal Softworks. The editor contains no game files: it reads them from your own install.</li></ul>`],
];
function openGuide() {
  if (!$("#guide")) {
    document.body.insertAdjacentHTML("beforeend", `<div id="guide" class="modal hidden"><div class="modal-box guide-box">
      <div class="toolbar"><b>Starforge guide</b><span class="spacer" style="flex:1"></span><button id="guide-close">Close</button></div>
      <div class="guide-body"><nav id="guide-nav"></nav><div id="guide-text"></div></div></div></div>`);
    $("#guide-close").onclick = () => $("#guide").classList.add("hidden");
    $("#guide").onclick = (e) => { if (e.target.id === "guide") $("#guide").classList.add("hidden"); };
    $("#guide-nav").innerHTML = GUIDE.map(([t], i) => `<button data-g="${i}">${esc(t)}</button>`).join("");
    $("#guide-nav").onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) showGuidePage(+b.dataset.g); };
  }
  $("#guide").classList.remove("hidden"); showGuidePage(0);
  try { localStorage.setItem("forge.guideSeen", "1"); } catch (e) { /* ignore */ }
}
function showGuidePage(i) {
  $("#guide-text").innerHTML = `<h2>${esc(GUIDE[i][0])}</h2>${GUIDE[i][1]}`;
  document.querySelectorAll("#guide-nav button").forEach((b) => b.classList.toggle("active", +b.dataset.g === i));
}
$("#open-guide").onclick = openGuide;
try { if (!localStorage.getItem("forge.guideSeen")) setTimeout(() => { if ($("#loading").classList.contains("hidden")) openGuide(); else { const iv = setInterval(() => { if ($("#loading").classList.contains("hidden")) { clearInterval(iv); openGuide(); } }, 300); } }, 300); } catch (e) { /* ignore */ }

document.head.insertAdjacentHTML("beforeend", `<style>
.jform { margin-top: 4px; }
.jf-sub { grid-column: 1 / -1; margin-top: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); }
.colf { display: flex; gap: 6px; align-items: center; min-width: 0; }
.colf input[type=color] { width: 38px; height: 26px; padding: 0; border: 1px solid var(--line); background: none; flex: none; }
.colf input[type=color].unset { opacity: .35; }
.colf input[type=range] { width: 70px; flex: none; }
.colf .coltxt { flex: 1; min-width: 0; }
.vec2 { display: flex; gap: 6px; } .vec2 input { flex: 1; min-width: 0; }
.has-help { text-decoration: underline dotted rgba(140,170,200,.6); text-underline-offset: 3px; cursor: help; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.fac-table th { text-align: left; font-size: 11px; color: #8aa; font-weight: normal; padding: 2px 6px; position: sticky; top: 0; background: var(--panel); }
.fac-table td { padding: 3px 6px; }
.role-grid, .tag-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 2px 10px; font-size: 12px; margin-top: 6px; }
.use-list { display: flex; flex-direction: column; gap: 3px; }
.use { padding: 4px 8px; background: var(--panel2); border: 1px solid var(--line); border-radius: 5px; font-size: 12px; }
.use.link { cursor: pointer; } .use.link:hover { border-color: var(--accent); }
#hm-grid .card { cursor: pointer; } #hm-grid .card.selected { border-color: var(--accent); }
#hm-detail { width: 460px; }
.guide-box { width: min(980px, 94vw); height: min(680px, 88vh); }
.guide-body { flex: 1; display: flex; min-height: 0; }
#guide-nav { width: 220px; flex: none; border-right: 1px solid var(--line); padding: 8px; display: flex; flex-direction: column; gap: 4px; }
#guide-nav button { text-align: left; } #guide-nav button.active { border-color: var(--accent); color: var(--accent); }
#guide-text { flex: 1; overflow: auto; padding: 4px 18px 18px; line-height: 1.55; }
#guide-text li { margin: 4px 0; }
#dlg .modal-box { height: auto; max-height: 90vh; }
#dlg-body { overflow: auto; }
</style>`);

// ================================================================ MOD PICKER
/** Clears the hullmod/system/faction editors' state after a reload. */
function resetToolDocs() {
  for (const k of Object.keys(S.hullmodDocs)) delete S.hullmodDocs[k];
  for (const k of Object.keys(S.systemDocs)) delete S.systemDocs[k];
  for (const k of Object.keys(S.factionDocs)) delete S.factionDocs[k];
  HM = null; SY = null; S.systems = null; S.factions = null; S.roles = null;
  for (const k of Object.keys(SND.cache)) delete SND.cache[k];
  $("#hm-detail").innerHTML = '<p class="muted">Click a hullmod to edit its name, OP costs, tags, icon and texts.</p>';
  $("#sys-detail").innerHTML = '<p class="muted">Select a ship system to edit it.</p>'; $("#sys-list").innerHTML = "";
}
const MOD_MODES = {
  enabled: ["Mods enabled in the game launcher", "Same mods the game loads (mods/enabled_mods.json)."],
  all: ["All installed mods", "Every mod folder, enabled or not. Slowest with many mods."],
  custom: ["Only the mods I choose", "Tick exactly which mod folders to load (pick one version when you have duplicates)."],
};
function renderModMode() {
  const st = S.settings || {}, mode = st.modMode || "all";
  const n = (S.sources || []).filter((s) => !s.core).length;
  const txt = `Loading: ${MOD_MODES[mode] ? MOD_MODES[mode][0].toLowerCase() : mode} (${n} mod${n === 1 ? "" : "s"} + vanilla)`;
  $("#mod-mode").textContent = txt;
  $("#open-mods").title = txt + ". Click to change.";
}
async function openModPicker() {
  let mods;
  try { mods = await api("/api/modlist"); } catch (e) { toast("Couldn't list mods: " + e.message, true); return; }
  mods.sort((a, b) => String(a.name || a.folder).localeCompare(String(b.name || b.folder)) || compareVer(b.version, a.version));
  const st = S.settings || {}, mode0 = st.modMode || "all";
  // starting ticks: the saved custom list, or else what is loaded right now
  const saved = new Set((st.selectedFolders || []).map((x) => x.toLowerCase()));
  const tick = new Set(mods.filter((m) => (mode0 === "custom" && saved.size ? saved.has(m.folder.toLowerCase()) : m.loaded)).map((m) => m.folder));
  const byId = {}; for (const m of mods) (byId[m.id] = byId[m.id] || []).push(m);
  const newest = (id) => byId[id].slice().sort((a, b) => compareVer(b.version, a.version) || b.folder.localeCompare(a.folder))[0];

  openDialog("Choose which mods to load", "Apply & reload", `
    <div class="mm-modes">${Object.entries(MOD_MODES).map(([k, [t, d]]) => `<label class="mm-mode"><input type="radio" name="mm" value="${k}" ${k === mode0 ? "checked" : ""}> <b>${esc(t)}</b><div class="muted">${esc(d)}</div></label>`).join("")}</div>
    <div class="toolbar mm-tools">
      <input id="mm-search" placeholder="Filter by name, id or folder…" style="flex:1;min-width:160px">
      <button data-mm="game" title="Tick the mods enabled in the game launcher">Game's selection</button>
      <button data-mm="all">All</button><button data-mm="none">None</button>
      <button data-mm="newest" title="Where several versions of a mod are ticked, keep only the newest">Newest versions only</button>
      <button data-mm="deps" title="Tick mods that ticked mods depend on">Add dependencies</button>
    </div>
    <div id="mm-status" class="muted" style="font-size:12px;margin:4px 0"></div>
    <div class="mm-list"><table class="kv mm-table"><thead><tr><th></th><th>Mod</th><th>Version</th><th>Folder</th><th></th></tr></thead><tbody id="mm-body"></tbody></table></div>
    <p class="muted" style="font-size:12px;margin-top:6px">Vanilla is always loaded. This only changes what the editor reads: the game launcher's own selection isn't touched. Fewer mods load faster.</p>`,
    async (root) => {
      const mode = root.querySelector('[name="mm"]:checked').value;
      const sel = mods.filter((m) => tick.has(m.folder)).map((m) => m.folder);
      if (mode === "custom" && !sel.length && !confirm("No mods ticked: only vanilla will be loaded. Continue?")) throw new Error("Tick at least one mod, or confirm loading vanilla only.");
      const next = { modMode: mode, selectedFolders: mode === "custom" ? sel : (st.selectedFolders || []) };
      closeDialog();
      const ok = await reloadAll(next);
      if (ok) toast("Reloaded with " + (S.sources.length - 1) + " mod(s).");
      return false;
    });
  $("#dlg .modal-box").classList.add("mm-box");
  const body = $("#dlg-body");
  const curMode = () => body.querySelector('[name="mm"]:checked').value;
  const effective = (m) => { const md = curMode(); return md === "custom" ? tick.has(m.folder) : md === "all" ? newest(m.id) === m : m.enabledInGame && newest(m.id) === m; };
  const render = () => {
    const md = curMode(), q = body.querySelector("#mm-search").value.trim().toLowerCase();
    const on = mods.filter(effective), onIds = new Set(on.map((m) => m.id));
    const missing = {}; for (const m of on) for (const d of m.dependencies || []) if (!onIds.has(d)) (missing[m.folder] = missing[m.folder] || []).push(d);
    const dupTicked = Object.values(byId).filter((l) => l.filter(effective).length > 1).length;
    body.querySelector("#mm-body").innerHTML = mods.filter((m) => !q || `${m.name} ${m.id} ${m.folder}`.toLowerCase().includes(q)).map((m) => {
      const dup = byId[m.id].length > 1, eff = effective(m), miss = missing[m.folder];
      return `<tr class="${eff ? "on" : ""}" data-f="${esc(m.folder)}">
        <td><input type="checkbox" ${eff ? "checked" : ""} ${md === "custom" ? "" : "disabled"}></td>
        <td><b>${esc(m.name || m.id)}</b> <span class="muted">${esc(m.id || "")}</span>
          ${m.enabledInGame ? '<span class="badge ok" title="Enabled in the game launcher">in game</span>' : ""}
          ${m.loaded ? '<span class="badge" title="Loaded in the editor right now">loaded</span>' : ""}
          ${m.utility ? '<span class="badge" title="Utility mod (usually no ships or weapons)">utility</span>' : ""}
          ${m.totalConversion ? '<span class="badge restart">total conversion</span>' : ""}
          ${!m.hasData ? '<span class="badge" title="No data or graphics folder: nothing for the editor">no data</span>' : ""}
          ${miss ? `<div class="mm-warn">Needs: ${miss.map(esc).join(", ")}</div>` : ""}
          ${m.error ? `<div class="mm-warn">${esc(m.error)}</div>` : ""}</td>
        <td>${esc(m.version || "")}${dup ? ` <span class="badge restart" title="${byId[m.id].length} folders share this mod id">${newest(m.id) === m ? "newest" : "older copy"}</span>` : ""}</td>
        <td class="muted" style="font-size:11px">${esc(m.folder)}</td>
        <td class="muted" style="font-size:11px">${esc(m.gameVersion ? "game " + m.gameVersion : "")}</td></tr>`;
    }).join("");
    const nMiss = Object.keys(missing).length;
    body.querySelector("#mm-status").innerHTML = `<b>${on.length}</b> of ${mods.length} mod folders will load` +
      (dupTicked ? ` · <span class="mm-warn">${dupTicked} mod${dupTicked > 1 ? "s have" : " has"} more than one version ticked (the newest is used)</span>` : "") +
      (nMiss ? ` · <span class="mm-warn">${nMiss} mod${nMiss > 1 ? "s are" : " is"} missing a dependency</span>` : "");
    body.querySelectorAll(".mm-tools button").forEach((b) => (b.disabled = md !== "custom"));
  };
  body.addEventListener("change", (e) => {
    if (e.target.name === "mm") {
      if (e.target.value === "custom" && !tick.size) for (const m of mods) if (m.loaded) tick.add(m.folder);
      return render();
    }
    const tr = e.target.closest("tr[data-f]"); if (!tr) return;
    e.target.checked ? tick.add(tr.dataset.f) : tick.delete(tr.dataset.f);
    render();
  });
  body.querySelector("#mm-search").oninput = render;
  body.querySelector(".mm-tools").onclick = (e) => {
    const a = e.target.dataset && e.target.dataset.mm; if (!a) return;
    if (a === "game") { tick.clear(); for (const id in byId) { const l = byId[id].filter((m) => m.enabledInGame); if (l.length) tick.add(newest(id).enabledInGame ? newest(id).folder : l[0].folder); } }
    if (a === "all") { tick.clear(); for (const id in byId) tick.add(newest(id).folder); }
    if (a === "none") tick.clear();
    if (a === "newest") for (const id in byId) { const l = byId[id].filter((m) => tick.has(m.folder)); if (l.length > 1) { l.forEach((m) => tick.delete(m.folder)); tick.add(newest(id).folder); } }
    if (a === "deps") {
      let added = 0, more = true;
      while (more) { more = false; for (const m of mods.filter((x) => tick.has(x.folder))) for (const d of m.dependencies || []) if (byId[d] && !byId[d].some((x) => tick.has(x.folder))) { tick.add(newest(d).folder); added++; more = true; } }
      toast(added ? `Added ${added} dependenc${added > 1 ? "ies" : "y"}.` : "No missing dependencies that are installed.");
    }
    render();
  };
  render();
}
function compareVer(a, b) {
  const x = String(a || "").split(/[^0-9A-Za-z]+/), y = String(b || "").split(/[^0-9A-Za-z]+/);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] || "0", q = y[i] || "0", np = parseInt(p, 10) || 0, nq = parseInt(q, 10) || 0;
    if (np !== nq) return np < nq ? -1 : 1;
    const c = p.replace(/^\d+/, "").localeCompare(q.replace(/^\d+/, "")); if (c) return c;
  }
  return 0;
}
$("#open-mods").onclick = openModPicker;
$("#choose-mods").onclick = openModPicker;
if (S.settings) renderModMode();
document.head.insertAdjacentHTML("beforeend", `<style>
#dlg .modal-box.mm-box { width: min(1100px, 95vw) !important; }
.mm-modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
.mm-mode { border: 1px solid var(--line); border-radius: 6px; padding: 8px; cursor: pointer; font-size: 13px; }
.mm-mode:has(input:checked) { border-color: var(--accent); background: var(--panel2); }
.mm-mode .muted { font-size: 11px; margin-top: 3px; }
.mm-tools { flex-wrap: wrap; gap: 6px; }
.mm-list { max-height: 48vh; overflow: auto; border: 1px solid var(--line); border-radius: 6px; }
.mm-table { width: 100%; } .mm-table td { padding: 4px 6px; vertical-align: top; }
table.kv.mm-table td:first-child { width: 26px; color: inherit; } .mm-table tr.on td { background: rgba(80,140,200,.07); }
.mm-table th { position: sticky; top: 0; background: var(--panel); text-align: left; font-weight: normal; font-size: 11px; color: #8aa; padding: 4px 6px; }
.mm-table .badge { margin-left: 4px; font-size: 10px; }
.mm-warn { color: #e9b04a; font-size: 11px; }
.badge.ok { background: rgba(90,190,120,.18); color: #8fdca8; }
</style>`);


// ================================================================ OPEN FILES
function shipFiles(c) {
  const out = [];
  if (c.isSkin) { out.push({ label: "Skin file (.skin)", path: c.file.path }); if (c.baseFile) out.push({ label: "Base hull file (.ship)", path: c.baseFile.path }); }
  else out.push({ label: "Hull file (.ship)", path: c.file.path });
  out.push({ label: "Stats row (ship_data.csv)" + (c.isSkin ? ", base hull's" : ""), path: c.csv && c.csv._file, csv: true });
  if (c.variantFile) out.push({ label: `Variant ${c.variantFile.variantId || ""} (.variant)`, path: c.variantFile.path });
  out.push({ label: "Description (descriptions.csv)", path: c.desc && c.desc._file, csv: true });
  out.push({ label: "Sprite", rel: spriteOf(c) });
  return out;
}
function weaponFiles() {
  const w = W.wpn, out = [{ label: "Weapon file (.wpn)", path: W.wpnPath }, { label: "Stats row (weapon_data.csv)", path: W.row._file, csv: true }];
  if (W.projPath || W.proj) out.push({ label: "Projectile (.proj)", path: W.projPath });
  out.push({ label: "Description (descriptions.csv)", path: W.desc && W.desc._file, csv: true });
  for (const k of ["turretSprite", "turretGunSprite", "turretGlowSprite", "turretUnderSprite", "hardpointSprite", "hardpointGunSprite", "hardpointGlowSprite", "hardpointUnderSprite"])
    if (w[k]) out.push({ label: k, rel: w[k] });
  if (W.proj && (W.proj.bulletSprite || W.proj.sprite)) out.push({ label: "Projectile sprite", rel: W.proj.bulletSprite || W.proj.sprite });
  return out;
}
function wingFiles() {
  const out = [{ label: "Wing row (wing_data.csv)", path: WG.row._file, csv: true }];
  if (WG.fv) out.push({ label: `Fighter variant ${WG.row.variant} (.variant)`, path: WG.fv.path });
  if (WG.fh) { out.push({ label: `Fighter hull ${WG.fhId} (.ship/.skin)`, path: WG.fh.file && WG.fh.file.path }); out.push({ label: "Fighter stats row (ship_data.csv)", path: WG.hull && WG.hull._file, csv: true }); }
  const sh = WG.fh && (WG.fh.ship || WG.fh.baseShip), sp = (WG.fh && WG.fh.skin && WG.fh.skin.spriteName) || (sh && sh.spriteName);
  if (sp) out.push({ label: "Fighter sprite", rel: sp });
  return out;
}
ACTIONS.files = (ds, ev) => openFilesMenu((ev && ev.target.closest("button")) || document.querySelector('[data-act="files"]'), shipFiles(S.cur));
async function openFileOnDisk(item, reveal) {
  try {
    const r = await api("/api/openfile", item.path ? { path: item.path, reveal } : { rel: item.rel, reveal });
    toast(reveal ? "Shown in its folder." : `Opened in ${r.how}.` + (item.csv && !reveal ? " If it opened in Excel, close it before saving from the editor (Excel locks the file)." : ""));
  } catch (e) { toast("Couldn't open it: " + e.message, true); }
}
function openFilesMenu(anchor, items) {
  closeFilesMenu();
  const m = document.createElement("div"); m.id = "files-menu";
  const shown = items.filter((x) => x.path || x.rel || x.label);
  m.innerHTML = `<div class="fm-head">Files <span class="muted">(Open uses your text editor if set below, else the system default)</span></div>` + shown.map((x, i) => {
    const where = x.path || x.rel || "";
    const ok = !!(x.path || x.rel);
    return `<div class="fm-row"><div class="fm-t"><b>${esc(x.label)}</b><div class="muted fm-p" title="${esc(where)}">${ok ? esc(where) : "no file: it doesn't exist, or isn't saved yet (Changes → Save all)"}</div></div>
      <button data-i="${i}" data-a="open" ${ok ? "" : "disabled"} title="${x.csv ? "Opens the whole CSV (in your spreadsheet app or text editor)" : "Open the file"}">Open</button>
      <button data-i="${i}" data-a="reveal" ${ok ? "" : "disabled"} title="Show it selected in Explorer">Show in folder</button></div>`;
  }).join("") + `<div class="fm-foot"><label class="muted" title="Full path to the program used for text files (.ship, .wpn, .csv, .json…), e.g. C:\\Program Files\\Notepad++\\notepad++.exe. Blank = system default (Notepad when nothing is associated).">Text editor
    <input id="fm-editor" placeholder="blank = system default (e.g. C:\\Program Files\\Notepad++\\notepad++.exe)" value="${esc((S.settings && S.settings.textEditor) || "")}"></label></div>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4) + "px";
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + "px";
  m.onclick = (e) => { const b = e.target.closest("button[data-a]"); if (b) openFileOnDisk(shown[+b.dataset.i], b.dataset.a === "reveal"); };
  m.querySelector("#fm-editor").onchange = async (e) => {
    const v = e.target.value.trim().replace(/^"(.*)"$/, "$1");
    S.settings = await api("/api/settings", { textEditor: v }); toast(v ? "Text files will open in " + v : "Text files will open with the system default.");
  };
  setTimeout(() => document.addEventListener("mousedown", closeFilesOutside, true), 0);
}
function closeFilesOutside(e) { if (!e.target.closest("#files-menu")) closeFilesMenu(); }
function closeFilesMenu() { const m = $("#files-menu"); if (m) m.remove(); document.removeEventListener("mousedown", closeFilesOutside, true); }
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#files-menu")) { e.stopImmediatePropagation(); closeFilesMenu(); } }, true);
document.head.insertAdjacentHTML("beforeend", `<style>
#files-menu { position: fixed; z-index: 60; width: min(560px, 94vw); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 6px; }
.fm-head { padding: 4px 6px 6px; font-weight: 600; } .fm-head .muted { font-weight: normal; font-size: 11px; }
.fm-row { display: flex; gap: 6px; align-items: center; padding: 5px 6px; border-top: 1px solid var(--line); }
.fm-t { flex: 1; min-width: 0; font-size: 12px; } .fm-p { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.fm-row button { flex: none; padding: 2px 8px; font-size: 12px; }
.fm-foot { border-top: 1px solid var(--line); padding: 6px; } .fm-foot label { display: flex; gap: 8px; align-items: center; font-size: 12px; } .fm-foot input { flex: 1; min-width: 0; }
.list .item .noimg { width: 32px; height: 32px; flex: none; }
</style>`);


// ================================================================ FINDING THE STARSECTOR FOLDER
async function startup() {
  let st;
  try { st = await api("/api/setup"); } catch (e) { st = { gameDir: "?" }; }
  if (!st.gameDir) { $("#loading").classList.add("hidden"); openGamePicker(st, true); return; }
  await boot();
}
const _rmm = renderModMode;
renderModMode = function () { _rmm(); if (S.summary) $("#game-dir").textContent = S.summary.gameDir || ""; };
/** first = true on first run (no way to cancel). */
async function openGamePicker(st, first) {
  st = st || (await api("/api/setup"));
  const found = (st.found || []).filter((f) => f !== st.gameDir);
  openDialog(first ? "Where is Starsector?" : "Choose a Starsector folder", "Use this folder", `
    <p style="margin-top:0">${first ? "The editor couldn't find your Starsector installation automatically. " : ""}Pick the folder that contains
      <code>starsector-core</code> (Windows), <code>Starsector.app</code> (macOS) or <code>starsector.sh</code> (Linux). It's remembered in
      <code title="${esc(st.pathFile || "")}">starsector-path.txt</code> next to the editor.</p>
    ${st.gameDir && !first ? `<p class="muted" style="font-size:12px">Current: <code>${esc(st.gameDir)}</code></p>` : ""}
    ${found.length ? `<h3>Found on this computer</h3><div class="gp-found">${found.map((f) => `<div class="gp-row"><code>${esc(f)}</code><button data-use="${esc(f)}" class="primary">Use</button></div>`).join("")}</div>` : ""}
    <h3>Browse</h3>
    <div class="toolbar gp-bar"><button id="gp-up" title="Parent folder">↑</button><input id="gp-path" style="flex:1" title="Type or paste a path and press Enter"><span id="gp-roots"></span></div>
    <div id="gp-list" class="gp-list"></div>
    <div id="gp-state" class="muted" style="font-size:12px;margin-top:6px"></div>`,
    async () => {
      await useGameDir($("#gp-path").value, first);
      return false;
    });
  if (first) { $("#dlg-cancel").style.display = "none"; $("#dlg .modal-box").classList.add("mm-box"); }
  const body = $("#dlg-body");
  let cur = null;
  const go = async (path) => {
    let r;
    try { r = await api("/api/browse?path=" + encodeURIComponent(path || "")); } catch (e) { $("#gp-state").textContent = e.message; return; }
    cur = r; $("#gp-path").value = r.path;
    $("#gp-roots").innerHTML = r.roots.map((x) => `<button data-go="${esc(x)}" title="Go to ${esc(x)}">${esc(x)}</button>`).join("") + `<button data-go="${esc(r.home)}" title="Your home folder">Home</button>`;
    $("#gp-list").innerHTML = r.error ? `<p class="muted">${esc(r.error)}</p>` : !r.dirs.length ? '<p class="muted">No folders here.</p>' :
      r.dirs.map((d) => `<div class="gp-dir${d.starsector ? " ss" : ""}" data-go="${esc(r.path.replace(/[\\/]+$/, "") + (r.path.includes("\\") ? "\\" : "/") + d.name)}">📁 ${esc(d.name)}${d.starsector ? ' <span class="badge ok">Starsector</span> <button class="primary" data-pick="1">Use</button>' : ""}</div>`).join("");
    $("#gp-state").innerHTML = r.isStarsector ? '<span style="color:#8fdca8">✓ This is a Starsector folder.</span>' : "Open the folder that holds the game, then press “Use this folder”.";
    $("#dlg-ok").disabled = false;
  };
  body.addEventListener("click", (e) => {
    const use = e.target.closest("[data-use]"); if (use) return useGameDir(use.dataset.use, first);
    const row = e.target.closest("[data-go]"); if (!row) return;
    if (e.target.dataset.pick) return useGameDir(row.dataset.go, first);
    go(row.dataset.go);
  });
  $("#gp-up").onclick = () => cur && cur.parent && go(cur.parent);
  $("#gp-path").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); go($("#gp-path").value); } };
  go(st.gameDir && !first ? st.gameDir : found[0] || "");
}
async function useGameDir(path, first) {
  if (!first && CH.entries.size && !confirm(`Switching discards ${CH.entries.size} pending change(s) and closes all tabs. Continue?`)) return;
  let r;
  try { r = await api("/api/setgamedir", { path }); } catch (e) { $("#gp-state").innerHTML = `<span class="mm-warn" style="font-size:12px">${esc(e.message)}</span>`; return; }
  closeDialog();
  toast("Using " + r.gameDir);
  if (first) { $("#loading").classList.remove("hidden"); await boot(); }
  else { CH.entries.clear(); await reloadAll(); }
}
$("#change-game").onclick = () => openGamePicker(null, false);
document.head.insertAdjacentHTML("beforeend", `<style>
.gp-found { display: flex; flex-direction: column; gap: 4px; }
.gp-row { display: flex; gap: 8px; align-items: center; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; }
.gp-row code { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.gp-bar { gap: 4px; flex-wrap: wrap; } #gp-roots { display: flex; gap: 4px; flex-wrap: wrap; } #gp-roots button { padding: 2px 8px; font-size: 12px; }
.gp-list { height: 300px; overflow: auto; border: 1px solid var(--line); border-radius: 6px; margin-top: 6px; }
.gp-dir { padding: 4px 10px; cursor: pointer; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,.03); }
.gp-dir:hover { background: var(--panel2); } .gp-dir.ss { background: rgba(90,190,120,.08); }
.gp-dir button { padding: 1px 10px; font-size: 11px; margin-left: 6px; }
#game-dir { font-size: 12px; }
</style>`);


// ================================================================ BACKUPS
async function openBackups() {
  let b;
  try { b = await api("/api/backups"); } catch (e) { toast("Couldn't list backups: " + e.message, true); return; }
  const short = (p) => { const m = String(p).replace(/\\/g, "/").match(/mods\/(.*)$/); return m ? m[1] : p; };
  openDialog("Backups", "Close", `
    <p class="muted" style="font-size:12px;margin-top:0">Before <b>Save all</b> changes a file, the editor copies it to
      <code>${esc(b.folder)}</code>, one folder per save (the newest ${b.keep} are kept). <b>Restore</b> puts every file from that save
      back as it was before it; your current versions are backed up first, so a restore can be undone too.</p>
    <div class="btnrow"><button id="bk-folder">Show backups folder</button></div>
    ${!b.batches.length ? '<p class="muted">No backups yet: they appear after your first Save all.</p>' : `<div class="bk-list">${b.batches.map((x) => {
      const created = x.files.filter((f) => !f.existed).length, changed = x.files.length - created;
      return `<details class="bk"><summary><b>${esc(x.time || x.id)}</b> <span class="muted">${changed} changed${created ? `, ${created} new` : ""}${x.restoredFrom ? ` · state before restoring ${esc(x.restoredFrom)}` : ""}</span>
        <span class="spacer" style="flex:1"></span><button data-restore="${esc(x.id)}" data-created="${created}">Restore</button><button data-show="${esc(x.id)}" title="Open this backup's folder">Folder</button></summary>
        <div class="bk-files">${x.files.map((f) => `<div><span class="badge ${f.existed ? "" : "live"}">${f.existed ? "changed" : "new"}</span> <code title="${esc(f.path)}">${esc(short(f.path))}</code></div>`).join("")}</div></details>`;
    }).join("")}</div>`}`, () => {});
  $("#dlg-cancel").style.display = "none"; $("#dlg .modal-box").classList.add("mm-box");
  $("#bk-folder").onclick = () => api("/api/backups/open", {}).catch((e) => toast(e.message, true));
  $("#dlg-body").onclick = async (e) => {
    const sh = e.target.closest("[data-show]"); if (sh) { e.preventDefault(); api("/api/backups/open", { id: sh.dataset.show }).catch((x) => toast(x.message, true)); return; }
    const r = e.target.closest("[data-restore]"); if (!r) return;
    e.preventDefault();
    const created = +r.dataset.created;
    if (!confirm(`Restore every file from the save at ${r.closest("summary").querySelector("b").textContent}?\nYour current versions are backed up first.` + (CH.entries.size ? `\n\nThis also discards ${CH.entries.size} pending change(s) and reloads.` : "\n\nThe editor reloads afterwards."))) return;
    const removeCreated = created > 0 && confirm(`That save also created ${created} new file(s). Remove them as well?\n(OK = remove, Cancel = keep them)`);
    try {
      const res = await api("/api/backups/restore", { id: r.dataset.restore, removeCreated });
      closeDialog(); CH.entries.clear();
      await reloadAll();
      toast(`Restored ${res.restored} file(s)${res.removed ? `, removed ${res.removed}` : ""}.` + (res.problems.length ? " Skipped: " + res.problems.join("; ") : ""), res.problems.length > 0);
    } catch (x) { toast("Restore failed: " + x.message, true); }
  };
}
$("#changes-backups").onclick = openBackups;
$("#open-backups").onclick = openBackups;
document.head.insertAdjacentHTML("beforeend", `<style>
.bk-list { display: flex; flex-direction: column; gap: 4px; max-height: 60vh; overflow: auto; }
.bk { border: 1px solid var(--line); border-radius: 6px; }
.bk summary { display: flex; gap: 8px; align-items: center; padding: 6px 10px; cursor: pointer; }
.bk summary button { padding: 2px 10px; font-size: 12px; }
.bk-files { padding: 4px 12px 8px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
</style>`);
