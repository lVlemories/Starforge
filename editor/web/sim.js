// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
/* ============================================================================
 * Weapon firing preview for the weapon editor.
 * Reads W.row (weapon_data.csv), W.wpn (.wpn) and W.proj (.proj) every frame, so edits show at once.
 * Approximates the game's visuals: charge glow, recoil, animated frames, muzzle flash / smoke,
 * ballistic, beam-like and plasma projectiles, missiles with engine flames and contrails, and beams.
 * World units are game pixels; the weapon sits at the origin facing +x ("left" is up on screen).
 * ========================================================================== */
const SIM = {
  id: null, on: true, speed: 1, zoom: 0, fit: true, target: true, targetDist: 0, open: true,
  st: null, shots: [], parts: [], fx: [], imgs: {}, tints: {}, raf: 0, last: 0, drag: false,
};
SIM.open = false; // hidden until the user opens it (stays open for the rest of the session)

const simN = (v, d = 0) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
const simRgba = (c, a = 1) => { c = Array.isArray(c) ? c : [255, 255, 255, 255]; return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${((c[3] ?? 255) / 255) * a})`; };
const simRnd = (a, b) => a + Math.random() * (b - a);

function simImg(path) {
  if (!path) return null;
  let e = SIM.imgs[path];
  if (!e) { e = SIM.imgs[path] = { img: new Image(), ok: false, bad: false }; e.img.onload = () => (e.ok = true); e.img.onerror = () => (e.bad = true); e.img.src = path.startsWith("/") ? path : asset(path); }
  return e.ok ? e.img : null;
}
/** White-ish texture multiplied by a colour, keeping the texture's alpha (cached). */
function simTint(path, color) {
  const img = simImg(path); if (!img) return null;
  const key = path + "|" + (color || []).join(",");
  let c = SIM.tints[key]; if (c) return c;
  c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0); g.globalCompositeOperation = "multiply"; g.fillStyle = simRgba([...(color || [255, 255, 255]).slice(0, 3), 255], 1); g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-in"; g.drawImage(img, 0, 0);
  if (color && color[3] != null && color[3] < 255) { g.globalCompositeOperation = "destination-in"; g.fillStyle = `rgba(0,0,0,${color[3] / 255})`; g.fillRect(0, 0, c.width, c.height); }
  return (SIM.tints[key] = c);
}
let _glowTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return (_glowTex = c);
}
const _glowTints = {};
function glowOf(color) {
  const k = (color || []).join(","); if (_glowTints[k]) return _glowTints[k];
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
  g.drawImage(glowTex(), 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = simRgba([...(color || [255, 255, 255]).slice(0, 3), 255], 1); g.fillRect(0, 0, 64, 64);
  if (color && color[3] != null && color[3] < 255) { g.globalCompositeOperation = "destination-in"; g.fillStyle = `rgba(0,0,0,${color[3] / 255})`; g.fillRect(0, 0, 64, 64); }
  return (_glowTints[k] = c);
}

// ---------------------------------------------------------------- spec (read live from the editor)
function simSpec() {
  const r = W.row || {}, w = W.wpn || {}, p = W.proj || {};
  const isBeam = w.specClass === "beam";
  const isMissile = p.specClass === "missile" || w.type === "MISSILE" && p.specClass === "missile";
  const hp = W.mount === "HARDPOINT";
  const offs = (hp ? w.hardpointOffsets : w.turretOffsets) || w.turretOffsets || [0, 0];
  const angs = (hp ? w.hardpointAngleOffsets : w.turretAngleOffsets) || w.turretAngleOffsets || [];
  const barrels = [];
  for (let i = 0; i + 1 < offs.length; i += 2) barrels.push({ x: simN(offs[i]), y: simN(offs[i + 1]), a: simN(angs[i / 2]) });
  if (!barrels.length) barrels.push({ x: 0, y: 0, a: 0 });
  const burstStr = String(r["burst size"] ?? "").trim();
  return {
    isBeam, isMissile, hp, barrels, w, p, r,
    range: Math.max(50, simN(r.range, 500)),
    chargeup: Math.max(0, simN(r.chargeup)), chargedown: Math.max(0, simN(r.chargedown)),
    burst: Math.max(1, Math.round(simN(r["burst size"], 1))), burstDelay: Math.max(0, simN(r["burst delay"])),
    beamBurst: isBeam && burstStr !== "" ? Math.max(0.05, simN(burstStr, 1)) : 0, beamCooldown: Math.max(0, simN(r["burst delay"])),
    beamSpeed: simN(r["beam speed"], 10000) || 10000,
    speed: simN(r["proj speed"], 600) || 600, launch: simN(r["launch speed"]), flight: simN(r["flight time"]),
    minSpread: simN(r["min spread"]), maxSpread: simN(r["max spread"]), spreadShot: simN(r["spread/shot"]), spreadDecay: simN(r["spread decay/sec"]),
    ammo: String(r.ammo ?? "").trim() === "" ? Infinity : Math.max(0, simN(r.ammo)), ammoSec: simN(r["ammo/sec"]), reloadSize: Math.max(1, simN(r["reload size"], 1)),
    dmg: simN(r["damage/shot"]), dps: simN(r["damage/second"]),
    barrelMode: w.barrelMode || "ALTERNATING", anim: w.animationType || "NONE",
    recoil: simN(w.visualRecoil), frames: Math.max(1, simN(w.numFrames, 1)), frameRate: simN(w.frameRate, 15),
  };
}

// ---------------------------------------------------------------- state machine
function simReset() {
  SIM.st = { phase: "idle", t: 0, barrel: 0, burstLeft: 0, spread: 0, ammo: null, ammoAcc: 0, glow: 0, recoil: [], loaded: [], frame: 0, frameT: 0,
    beam: 0, beamLen: 0, shots: 0, hits: 0, dmgLog: [], time: 0 };
  SIM.shots = []; SIM.parts = []; SIM.fx = [];
}
function simStep(dt, sp) {
  const st = SIM.st;
  st.time += dt;
  if (st.ammo == null || st.ammo > sp.ammo) st.ammo = sp.ammo;
  // ammo regeneration
  if (isFinite(sp.ammo) && st.ammo < sp.ammo && sp.ammoSec > 0) {
    st.ammoAcc += sp.ammoSec * dt;
    while (st.ammoAcc >= sp.reloadSize && st.ammo < sp.ammo) { st.ammoAcc -= sp.reloadSize; st.ammo = Math.min(sp.ammo, st.ammo + sp.reloadSize); }
  }
  st.spread = Math.max(sp.minSpread, st.spread - sp.spreadDecay * dt);
  for (let i = 0; i < sp.barrels.length; i++) st.recoil[i] = Math.max(0, (st.recoil[i] || 0) - dt / 0.22);
  const trigger = SIM.on && st.ammo >= 1;
  st.t += dt;

  if (sp.isBeam) { simBeamStep(dt, sp, trigger); return; }

  switch (st.phase) {
    case "idle":
      st.glow = Math.max(0, st.glow - dt * 3);
      if (trigger) { st.phase = "charge"; st.t = 0; if (sp.chargeup >= 0.2 && typeof simSound === "function") simSound("charge", sp); }
      break;
    case "charge":
      st.glow = sp.chargeup > 0 ? Math.min(1, st.t / sp.chargeup) : 1;
      if (st.t >= sp.chargeup) { st.burstLeft = sp.burst; st.phase = "burst"; st.t = sp.burstDelay; }
      break;
    case "burst":
      if (st.t >= sp.burstDelay || st.burstLeft === sp.burst) {
        if (st.ammo < 1) { st.phase = "cool"; st.t = 0; break; }
        simFire(sp); st.burstLeft--; st.t = 0;
        if (st.burstLeft <= 0) { st.phase = "cool"; st.t = 0; if (sp.barrelMode === "ALTERNATING_BURST") st.barrel = (st.barrel + 1) % sp.barrels.length; }
      }
      st.glow = 1;
      break;
    case "cool":
      st.glow = sp.chargedown > 0 ? Math.max(0, 1 - st.t / Math.max(0.15, sp.chargedown * 0.6)) : Math.max(0, st.glow - dt * 6);
      if (st.t >= sp.chargedown) { st.phase = trigger ? "charge" : "idle"; st.t = 0; for (let i = 0; i < sp.barrels.length; i++) st.loaded[i] = true; }
      break;
  }
  // animated sprites run while the weapon is busy
  if (sp.frames > 1 && (st.phase !== "idle" || sp.w.alwaysAnimate)) {
    st.frameT += dt * sp.frameRate; st.frame = Math.floor(st.frameT) % sp.frames;
  }
}
function simBeamStep(dt, sp, trigger) {
  const st = SIM.st;
  if (sp.beamBurst) {
    // charge up -> burst -> charge down -> cooldown
    if (st.phase === "idle") { st.beam = Math.max(0, st.beam - dt * 4); if (trigger) { st.phase = "charge"; st.t = 0; if (typeof simSound === "function") simSound("charge", sp); } }
    if (st.phase === "charge") { st.beam = sp.chargeup > 0 ? Math.min(1, st.t / sp.chargeup) : 1; if (st.t >= sp.chargeup) { st.phase = "burst"; st.t = 0; st.shots++; if (isFinite(sp.ammo)) st.ammo--; } }
    else if (st.phase === "burst") { st.beam = 1; if (st.t >= sp.beamBurst) { st.phase = "down"; st.t = 0; } }
    else if (st.phase === "down") { st.beam = sp.chargedown > 0 ? Math.max(0, 1 - st.t / sp.chargedown) : 0; if (st.t >= sp.chargedown) { st.phase = "cool"; st.t = 0; } }
    else if (st.phase === "cool") { st.beam = 0; if (st.t >= sp.beamCooldown) { st.phase = trigger ? "charge" : "idle"; st.t = 0; } }
  } else {
    if (trigger) { st.phase = "burst"; st.beam = sp.chargeup > 0 ? Math.min(1, st.beam + dt / sp.chargeup) : 1; }
    else { st.beam = sp.chargedown > 0 ? Math.max(0, st.beam - dt / sp.chargedown) : 0; if (!st.beam) st.phase = "idle"; else st.phase = "down"; }
  }
  st.glow = st.beam;
  if (st.beam > 0) st.beamLen = Math.min(simBeamMax(sp), st.beamLen + sp.beamSpeed * dt); else st.beamLen = 0;
  // damage while the beam touches the target
  const tg = simTarget(sp);
  if (tg && st.beam > 0 && st.beamLen >= tg.x - tg.r) { st.dmgLog.push([st.time, sp.dps * st.beam * dt]); if (Math.random() < dt * 30) simHitFx(tg.x - tg.r * 0.8, simRnd(-4, 4), sp.w.glowColor || sp.w.fringeColor, sp.w.width * 1.5 || 30); }
}
const simBeamMax = (sp) => { const tg = simTarget(sp); return tg ? Math.min(sp.range, tg.x - tg.r * 0.8) : sp.range; };
function simTarget(sp) {
  if (!SIM.target) return null;
  const x = SIM.targetDist > 0 ? SIM.targetDist : sp.range * 0.85;
  return { x, r: Math.max(30, Math.min(90, sp.range * 0.07)) };
}
/** World position and direction of barrel i (mount at origin, facing +x; y = left). */
function simMuzzle(sp, i) {
  const b = sp.barrels[i] || sp.barrels[0];
  return { x: b.x, y: b.y, a: (b.a * Math.PI) / 180 };
}
function simFire(sp) {
  const st = SIM.st;
  const idx = sp.barrelMode === "LINKED" ? sp.barrels.map((_, i) => i) : [st.barrel % sp.barrels.length];
  for (const i of idx) {
    const m = simMuzzle(sp, i);
    const ang = m.a + ((simRnd(-0.5, 0.5) * st.spread) * Math.PI) / 180;
    if (sp.isMissile) {
      const v0 = sp.launch || sp.speed * 0.3;
      SIM.shots.push({ kind: "missile", x: m.x, y: m.y, a: ang, v: v0, age: 0, trail: [], dead: 0, sp });
    } else {
      SIM.shots.push({ kind: "proj", x: m.x, y: m.y, a: ang, v: sp.speed, dist: 0, age: 0, fade: 0, sp });
    }
    st.recoil[i] = 1; st.loaded[i] = false;
    simMuzzleFx(sp, m, ang);
  }
  if (typeof simSound === "function") simSound("shot", sp);
  if (sp.barrelMode !== "LINKED" && sp.barrelMode !== "ALTERNATING_BURST") st.barrel = (st.barrel + 1) % sp.barrels.length;
  st.spread = Math.min(Math.max(sp.maxSpread, sp.minSpread), st.spread + sp.spreadShot);
  if (isFinite(sp.ammo)) st.ammo = Math.max(0, st.ammo - 1);
  st.shots++;
}
function simMuzzleFx(sp, m, ang) {
  const anim = sp.anim, w = sp.w;
  if ((anim === "MUZZLE_FLASH" || anim === "GLOW_AND_FLASH") && w.muzzleFlashSpec) {
    const f = w.muzzleFlashSpec, n = Math.min(80, simN(f.particleCount, 10)), len = simN(f.length, 20), dur = Math.max(0.03, simN(f.particleDuration, 0.2));
    const dir = len < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const a = ang + (simRnd(-0.5, 0.5) * simN(f.spread, 10) * Math.PI) / 180, d = Math.random() * Math.abs(len);
      const life = dur * simRnd(0.5, 1);
      SIM.parts.push({ x: m.x, y: m.y, vx: (Math.cos(a) * d * dir) / life, vy: (Math.sin(a) * d * dir) / life,
        size: simN(f.particleSizeMin, 10) + Math.random() * simN(f.particleSizeRange, 10), age: 0, life, color: f.particleColor || [255, 200, 120, 255], add: true, drag: 3 });
    }
  }
  if (anim === "SMOKE" && w.smokeSpec) {
    const s = w.smokeSpec, col = s.particleColor || [120, 120, 120, 180];
    for (let k = 0; k < simN(s.cloudParticleCount, 3); k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * simN(s.cloudRadius, 10);
      SIM.parts.push({ x: m.x + Math.cos(a) * r, y: m.y + Math.sin(a) * r, vx: Math.cos(a) * 8, vy: Math.sin(a) * 8, grow: 0.8,
        size: simN(s.particleSizeMin, 15) + Math.random() * simN(s.particleSizeRange, 15), age: 0, life: simN(s.cloudDuration, 1) * simRnd(0.6, 1), color: col, add: false, smoke: true });
    }
    for (let k = 0; k < simN(s.blowbackParticleCount, 3); k++) {
      const a = ang + Math.PI + (simRnd(-0.5, 0.5) * simN(s.blowbackSpread, 10) * Math.PI) / 180, life = simN(s.blowbackDuration, 1.5) * simRnd(0.6, 1);
      const d = simN(s.blowbackLength, 30) * simRnd(0.5, 1);
      SIM.parts.push({ x: m.x, y: m.y, vx: (Math.cos(a) * d) / life * 2, vy: (Math.sin(a) * d) / life * 2, drag: 2, grow: 0.6,
        size: simN(s.particleSizeMin, 15) + Math.random() * simN(s.particleSizeRange, 15), age: 0, life, color: col, add: false, smoke: true });
    }
  }
}
function simHitFx(x, y, color, radius) {
  SIM.fx.push({ x, y, age: 0, life: 0.25, r: Math.max(12, radius || 30), color: color || [255, 220, 160, 255] });
}
function simUpdateShots(dt) {
  const keep = [];
  for (const s of SIM.shots) {
    const sp = s.sp, tg = simTarget(sp);
    s.age += dt;
    if (s.kind === "proj") {
      const step = s.v * dt; s.x += Math.cos(s.a) * step; s.y += Math.sin(s.a) * step; s.dist += step;
      const fadeT = Math.max(0.05, simN(sp.p.fadeTime, 0.2));
      if (s.dist > sp.range) s.fade += dt / fadeT;
      if (tg && !s.fade && s.x >= tg.x - Math.sqrt(Math.max(0, tg.r * tg.r - s.y * s.y)) && Math.abs(s.y) < tg.r) {
        SIM.st.hits++; SIM.st.dmgLog.push([SIM.st.time, sp.dmg]);
        simHitFx(s.x, s.y, sp.p.fringeColor || sp.p.coreColor, Math.min(80, simN(sp.p.hitGlowRadius, 0) || simN(sp.p.width, 10) * 1.5));
        continue;
      }
      if (s.fade < 1) keep.push(s);
    } else {
      const eng = sp.p.engineSpec || {}, maxV = sp.speed, acc = simN(eng.acc, 500);
      if (!s.dead) {
        s.v = Math.min(maxV, s.v + acc * dt);
        if (tg) { // simple homing toward the dummy
          const want = Math.atan2(-s.y, tg.x - s.x), turn = (simN(eng.turnRate, 60) * Math.PI) / 180 * dt;
          let d = want - s.a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          s.a += Math.max(-turn, Math.min(turn, d));
        }
        if (sp.flight && s.age > sp.flight) s.dead = 0.001;
      } else { s.dead += dt; s.v = Math.max(0, s.v - simN(eng.dec, 300) * dt); }
      s.x += Math.cos(s.a) * s.v * dt; s.y += Math.sin(s.a) * s.v * dt;
      s.trail.push([s.x, s.y, SIM.st.time]); while (s.trail.length && SIM.st.time - s.trail[0][2] > 1.2) s.trail.shift();
      if (tg && Math.hypot(s.x - tg.x, s.y) < tg.r) {
        SIM.st.hits++; SIM.st.dmgLog.push([SIM.st.time, sp.dmg]);
        SIM.fx.push({ x: s.x, y: s.y, age: 0, life: 0.6, r: Math.max(30, simN(sp.p.explosionRadius, 80) * 0.6), color: sp.p.explosionColor || [255, 160, 80, 255], boom: true });
        continue;
      }
      if (!(s.dead > 1.5) && Math.hypot(s.x, s.y) < sp.range * 3) keep.push(s);
    }
  }
  SIM.shots = keep.length > 400 ? keep.slice(-400) : keep; // e.g. a projectile speed of 0 would pile up
  if (SIM.parts.length > 1500) SIM.parts.splice(0, SIM.parts.length - 1500);
  SIM.parts = SIM.parts.filter((p) => {
    p.age += dt; const dr = p.drag ? Math.exp(-p.drag * dt) : 1; p.vx *= dr; p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt; if (p.grow) p.size *= 1 + p.grow * dt; return p.age < p.life;
  });
  SIM.fx = SIM.fx.filter((f) => (f.age += dt) < f.life);
}

// ---------------------------------------------------------------- drawing
function simView(cv, sp) {
  const W_ = cv.width, H_ = cv.height, margin = 60 * (cv.width / cv.clientWidth || 1);
  if (SIM.fit || !SIM.zoom) SIM.zoom = Math.max(0.05, (W_ - margin * 2) / (sp.range * 1.08 + 60));
  return { s: SIM.zoom, ox: margin + 30 * SIM.zoom, oy: H_ / 2 };
}
function simDraw(cv, sp) {
  const g = cv.getContext("2d"), st = SIM.st, v = simView(cv, sp), s = v.s;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  g.fillStyle = "#06090e"; g.fillRect(0, 0, cv.width, cv.height);
  const X = (x) => v.ox + x * s, Y = (y) => v.oy - y * s;
  // grid every 100 units + range line
  g.strokeStyle = "rgba(120,150,190,.08)"; g.lineWidth = 1;
  for (let x = 0; X(x) < cv.width; x += 100) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), cv.height); g.stroke(); }
  for (let y = 0; Y(y) > 0; y += 100) for (const yy of [y, -y]) { g.beginPath(); g.moveTo(0, Y(yy)); g.lineTo(cv.width, Y(yy)); g.stroke(); }
  g.setLineDash([6, 6]); g.strokeStyle = "rgba(120,200,255,.35)"; g.beginPath(); g.moveTo(X(sp.range), 0); g.lineTo(X(sp.range), cv.height); g.stroke(); g.setLineDash([]);
  g.fillStyle = "rgba(120,200,255,.6)"; g.font = `${11 * devicePixelRatio}px sans-serif`; g.fillText(`range ${sp.range}`, X(sp.range) + 4, 14 * devicePixelRatio);
  // target dummy
  const tg = simTarget(sp);
  if (tg) {
    g.fillStyle = "rgba(90,105,125,.35)"; g.strokeStyle = "rgba(160,180,205,.55)"; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(tg.x), Y(0), tg.r * s, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(X(tg.x) - 6, Y(0)); g.lineTo(X(tg.x) + 6, Y(0)); g.moveTo(X(tg.x), Y(0) - 6); g.lineTo(X(tg.x), Y(0) + 6); g.stroke();
  }
  // world transform: units -> canvas, y up
  g.setTransform(s, 0, 0, -s, v.ox, v.oy);
  simDrawWorld(g, sp);
  g.setTransform(1, 0, 0, 1, 0, 0);
  simInset(g, cv, sp, v);
  simHud(g, cv, sp);
}
/** Close-up of the weapon in the lower-left corner when the main view is zoomed out. */
function simInset(g, cv, sp, v) {
  const w = sp.w, ref = simImg(sp.hp ? w.hardpointSprite || w.turretSprite : w.turretSprite);
  if (!ref) return;
  const ext = Math.max(ref.naturalWidth, ref.naturalHeight, ...sp.barrels.map((b) => Math.abs(b.x) + 10), 16);
  const d = devicePixelRatio, size = Math.min(cv.height * 0.62, 190 * d);
  const s2 = size / (ext * 2.4);
  if (s2 < v.s * 1.3) return; // main view is already close enough
  const x0 = 8 * d, y0 = cv.height - size - 8 * d;
  g.save();
  g.fillStyle = "#04070b"; g.strokeStyle = "rgba(120,150,190,.35)"; g.lineWidth = 1;
  g.fillRect(x0, y0, size, size); g.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  g.beginPath(); g.rect(x0, y0, size, size); g.clip();
  g.setTransform(s2, 0, 0, -s2, x0 + size * 0.32, y0 + size / 2);
  simDrawWorld(g, sp, true);
  g.restore();
  g.fillStyle = "rgba(160,180,205,.7)"; g.font = `${10 * d}px sans-serif`; g.fillText(`close-up ×${(s2 / d).toFixed(1)}`, x0 + 5 * d, y0 + 13 * d);
}
function simDrawWorld(g, sp, inset) {
  simDrawSmoke(g, false);
  for (const sh of SIM.shots) if (sh.kind === "missile") simDrawMissile(g, sh);
  simDrawWeapon(g, sp);
  if (sp.isBeam) simDrawBeams(g, sp);
  for (const sh of SIM.shots) if (sh.kind === "proj") simDrawProj(g, sh);
  simDrawSmoke(g, true);
  for (const f of SIM.fx) {
    const k = 1 - f.age / f.life, r = f.r * (f.boom ? 0.4 + 0.8 * (1 - k) : 1);
    g.globalCompositeOperation = "lighter"; g.globalAlpha = k;
    g.drawImage(glowOf(f.color), f.x - r, f.y - r, r * 2, r * 2);
    g.drawImage(glowOf([255, 255, 255, 255]), f.x - r * 0.35, f.y - r * 0.35, r * 0.7, r * 0.7);
  }
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
}
function simDrawSmoke(g, additive) {
  for (const p of SIM.parts) {
    if (p.add !== additive) continue;
    const k = 1 - p.age / p.life;
    g.globalCompositeOperation = additive ? "lighter" : "source-over";
    g.globalAlpha = Math.max(0, additive ? k : k * 0.9);
    const tex = p.smoke ? simTint("graphics/fx/smoke32.png", p.color) || glowOf(p.color) : glowOf(p.color);
    g.drawImage(tex, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}
function simSpritePath(path, sp) {
  if (!path || sp.frames <= 1) return path;
  const m = /^(.*?)(\d+)(\.png)$/i.exec(path); if (!m) return path;
  return m[1] + String(SIM.st.frame).padStart(m[2].length, "0") + m[3];
}
/** Draws the weapon sprites. In sprite space "up" is forward; we rotate so forward is +x. */
function simDrawWeapon(g, sp) {
  const w = sp.w, hp = sp.hp, st = SIM.st;
  const base = simImg(simSpritePath(hp ? w.hardpointSprite || w.turretSprite : w.turretSprite, sp)) || simImg(hp ? w.hardpointSprite || w.turretSprite : w.turretSprite);
  const under = simImg(hp ? w.hardpointUnderSprite : w.turretUnderSprite);
  const gunPath = hp ? w.hardpointGunSprite : w.turretGunSprite, gun = sp.recoil ? simImg(gunPath) : null;
  const glowPath = hp ? w.hardpointGlowSprite : w.turretGlowSprite;
  const ref = base || under; if (!ref) return;
  const iw = ref.naturalWidth, ih = ref.naturalHeight, ax = iw / 2, ay = hp ? ih * 0.75 : ih / 2;
  g.save();
  g.scale(1, -1); // back to y-down for sprites
  g.rotate(Math.PI / 2); // sprite up -> +x
  const rec = sp.recoil * Math.max(...sp.barrels.map((_, i) => st.recoil[i] || 0), 0);
  const below = (w.renderHints || []).includes("RENDER_BARREL_BELOW");
  const drawAt = (img, dy = 0) => img && g.drawImage(img, -ax, -ay + dy, iw, ih);
  drawAt(under);
  if (below) drawAt(gun, rec);
  drawAt(base);
  if (!below) drawAt(gun, rec);
  // loaded missiles sitting in the launcher
  if (sp.isMissile && (w.renderHints || []).includes("RENDER_LOADED_MISSILES") && sp.p.sprite) {
    const mi = simImg(sp.p.sprite), sz = sp.p.size || [10, 20], c = sp.p.center || [sz[0] / 2, sz[1] / 2];
    if (mi) sp.barrels.forEach((b, i) => {
      if (st.loaded[i] === false || st.ammo < 1) return;
      // barrel x = forward, y = left; in this rotated sprite space forward = -y, left = -x
      g.drawImage(mi, -b.y - c[0], -b.x - (sz[1] - c[1]), sz[0], sz[1]);
    });
  }
  // glow (charge-up / firing)
  const gl = sp.anim === "GLOW" || sp.anim === "GLOW_AND_FLASH" || sp.isBeam ? st.glow : 0;
  if (gl > 0 && glowPath) {
    const t = simTint(glowPath, w.glowColor || [255, 255, 255, 255]);
    if (t) { g.globalCompositeOperation = "lighter"; g.globalAlpha = gl; g.drawImage(t, -ax, -ay, iw, ih); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; }
  }
  g.restore();
  // mount point cross
  g.strokeStyle = "rgba(255,255,255,.25)"; g.lineWidth = 1 / Math.abs(g.getTransform().a);
  g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.moveTo(0, -3); g.lineTo(0, 3); g.stroke();
}
function simDrawProj(g, sh) {
  const sp = sh.sp, p = sp.p, a = Math.max(0, 1 - sh.fade);
  const len = Math.max(2, simN(p.length, 20)), wid = Math.max(1, simN(p.width, 4));
  const spawn = p.spawnType || "BALLISTIC";
  g.save(); g.translate(sh.x, sh.y); g.rotate(sh.a); g.globalAlpha = a;
  const traveled = Math.min(len, sh.dist + 2); // streaks grow out of the muzzle
  if (spawn === "PLASMA") {
    const r = wid / 2;
    g.globalCompositeOperation = "lighter";
    g.drawImage(glowOf(p.fringeColor || [100, 100, 255, 255]), -r * 1.6, -r * 1.6, r * 3.2, r * 3.2);
    g.drawImage(glowOf(p.coreColor || [255, 255, 255, 255]), -r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
  } else if (spawn === "BALLISTIC" && p.bulletSprite) {
    const img = simImg(p.bulletSprite);
    if (img) { g.rotate(-Math.PI / 2); g.scale(1, -1); g.drawImage(img, -wid / 2, -traveled * 0.15, wid, traveled); }
    else simStreak(g, traveled, wid, p);
  } else {
    simStreak(g, traveled, wid, p);
  }
  g.restore(); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}
/** Tapered streak from the head (x = 0) backwards, fringe + core, additive. */
function simStreak(g, len, wid, p) {
  g.globalCompositeOperation = "lighter";
  for (const [col, wf] of [[p.fringeColor || [255, 200, 120, 255], 1], [p.coreColor || [255, 255, 255, 200], 0.45]]) {
    const gr = g.createLinearGradient(-len, 0, 0, 0);
    gr.addColorStop(0, simRgba(col, 0)); gr.addColorStop(0.7, simRgba(col, 0.7)); gr.addColorStop(1, simRgba(col, 1));
    g.fillStyle = gr; const h = (wid * wf) / 2;
    g.beginPath(); g.moveTo(-len, 0); g.lineTo(-len * 0.15, h); g.quadraticCurveTo(0, h, 0, 0); g.quadraticCurveTo(0, -h, -len * 0.15, -h); g.closePath(); g.fill();
  }
}
const BEAM_TEX = { ROUGH: ["graphics/fx/beamfringe.png", "graphics/fx/beamcore.png"], SMOOTH: ["graphics/fx/beamfringec.png", "graphics/fx/beamcorec.png"],
  LASER: ["graphics/fx/beam_laser_fringe.png", "graphics/fx/beam_laser_core.png"], CHUNKY: ["graphics/fx/beam_chunky_fringe.png", "graphics/fx/beam_chunky_core.png"] };
function simDrawBeams(g, sp) {
  const st = SIM.st, w = sp.w; if (st.beam <= 0 || st.beamLen <= 0) return;
  const tex = Array.isArray(w.textureType) ? w.textureType : BEAM_TEX[w.textureType] || BEAM_TEX.ROUGH;
  const wid = Math.max(2, simN(w.width, 10)) * (0.4 + 0.6 * st.beam);
  for (let i = 0; i < sp.barrels.length; i++) {
    const m = simMuzzle(sp, i);
    g.save(); g.translate(m.x, m.y); g.rotate(m.a); g.globalCompositeOperation = "lighter"; g.globalAlpha = st.beam;
    const L = st.beamLen;
    let drew = false;
    for (const [path, col, wf] of [[tex[0], w.fringeColor, 1], [tex[1] || tex[0], w.coreColor, 0.5]]) {
      const t = simTint(path, col || [255, 255, 255, 255]);
      if (!t) continue; drew = true;
      const pat = g.createPattern(t, "repeat-x"); const ppt = Math.max(0.2, simN(w.pixelsPerTexel, 5)) / 5;
      const m2 = new DOMMatrix().translateSelf(-(SIM.st.scroll || 0) * 1, -wid * wf / 2).scaleSelf(ppt, (wid * wf) / t.height);
      pat.setTransform(m2); g.fillStyle = pat; g.fillRect(0, (-wid * wf) / 2, L, wid * wf);
    }
    if (!drew) { // no textures: plain gradient beam
      for (const [col, wf] of [[w.fringeColor, 1], [w.coreColor, 0.4]]) { const gr = g.createLinearGradient(0, -wid * wf / 2, 0, wid * wf / 2); gr.addColorStop(0, simRgba(col, 0)); gr.addColorStop(0.5, simRgba(col, 1)); gr.addColorStop(1, simRgba(col, 0)); g.fillStyle = gr; g.fillRect(0, -wid * wf / 2, L, wid * wf); }
    }
    // muzzle and impact glows
    const gc = w.glowColor || w.fringeColor || [255, 255, 255, 255], r = wid * 1.4;
    g.drawImage(glowOf(gc), -r, -r, r * 2, r * 2);
    if (L >= simBeamMax(sp) - 1) g.drawImage(glowOf(gc), L - r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
    g.restore();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
}
function simDrawMissile(g, sh) {
  const sp = sh.sp, p = sp.p, sz = p.size || [10, 20], c = p.center || [sz[0] / 2, sz[1] / 2];
  // contrail
  const slots = p.engineSlots || [];
  const ss = (slots[0] && slots[0].styleSpec) || {};
  const style = slots[0] && slots[0].style && slots[0].style !== "CUSTOM" ? (S.styles.engine || {})[slots[0].style] || {} : ss;
  const eCol = style.engineColor || ss.engineColor || [255, 160, 80, 255];
  const trailCol = style.contrailColor || ss.contrailColor;
  if (trailCol && sh.trail.length > 1) {
    const now = SIM.st.time, dur = Math.max(0.2, simN(style.contrailDuration ?? ss.contrailDuration, 1));
    g.lineCap = "round"; g.globalCompositeOperation = (style.type || ss.type) === "GLOW" ? "lighter" : "source-over";
    for (let i = 1; i < sh.trail.length; i++) {
      const [x0, y0, t0] = sh.trail[i - 1], [x1, y1] = sh.trail[i], k = 1 - (now - t0) / dur; if (k <= 0) continue;
      g.strokeStyle = simRgba(trailCol, k); g.lineWidth = simN(slots[0].width, 6) * simN(style.contrailWidthMult ?? ss.contrailWidthMult, 1) * (1 + (1 - k) * simN(style.contrailWidthAddedFractionAtEnd ?? ss.contrailWidthAddedFractionAtEnd, 0));
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.globalCompositeOperation = "source-over";
  }
  g.save(); g.translate(sh.x, sh.y); g.rotate(sh.a);
  const alpha = sh.dead ? Math.max(0, 1 - sh.dead / 1.5) : 1; g.globalAlpha = alpha;
  // engine flames (slot loc = [forward, left] relative to the missile center)
  if (!sh.dead) {
    const flick = 0.85 + Math.random() * 0.3;
    for (const e of slots) {
      const L = simN(e.length, 20) * flick, Wd = simN(e.width, 6), loc = e.loc || [0, 0], ang = ((simN(e.angle, 180)) * Math.PI) / 180;
      g.save(); g.translate(loc[0], loc[1]); g.rotate(ang); g.globalCompositeOperation = "lighter";
      const gr = g.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, simRgba(eCol, 1)); gr.addColorStop(1, simRgba(eCol, 0));
      g.fillStyle = gr; g.beginPath(); g.ellipse(L / 2, 0, L / 2, Wd / 2, 0, 0, Math.PI * 2); g.fill();
      g.drawImage(glowOf([255, 255, 255, 255]), -Wd * 0.4, -Wd * 0.4, Wd * 0.8, Wd * 0.8);
      g.restore();
    }
  }
  g.globalCompositeOperation = "source-over";
  const img = simImg(p.sprite);
  if (img) { g.scale(1, -1); g.rotate(Math.PI / 2); g.drawImage(img, -c[0], -(sz[1] - c[1]), sz[0], sz[1]); }
  else { g.fillStyle = "#ccd"; g.fillRect(-sz[1] / 2, -sz[0] / 2, sz[1], sz[0]); }
  g.restore(); g.globalAlpha = 1;
}
function simHud(g, cv, sp) {
  const st = SIM.st, d = devicePixelRatio;
  const now = st.time; st.dmgLog = st.dmgLog.filter(([t]) => now - t < 10);
  const win = Math.min(10, Math.max(1, now - (SIM.firstFire ?? now)));
  const dps = st.dmgLog.reduce((a, [, x]) => a + x, 0) / win;
  const phase = { idle: "idle", charge: "charging", burst: "firing", cool: sp.isBeam ? "cooldown" : "cooling down", down: "charging down" }[st.phase] || st.phase;
  const lines = [
    `${sp.isBeam ? (sp.beamBurst ? "burst beam" : "beam") : sp.isMissile ? "missile" : (sp.p.spawnType || "projectile").toLowerCase()} · ${phase}`,
    isFinite(sp.ammo) ? `ammo ${Math.floor(st.ammo)}/${sp.ammo}${sp.ammoSec ? ` (+${sp.ammoSec}/s)` : ""}` : "ammo ∞",
    `${sp.isBeam ? `bursts ${st.shots}` : `shots ${st.shots}`}${SIM.target ? `${sp.isBeam ? "" : ` · hits ${st.hits}`} · ${dps.toFixed(0)} DPS on target` : ""}`,
    !sp.isBeam && st.spread > 0 ? `spread ${st.spread.toFixed(1)}°` : "",
  ].filter(Boolean);
  g.font = `${12 * d}px sans-serif`; g.fillStyle = "rgba(210,225,240,.85)";
  lines.forEach((l, i) => g.fillText(l, 10 * d, (18 + i * 16) * d));
  if (!W.proj && !sp.isBeam && W.wpn.projectileSpecId) { g.fillStyle = "#e9b04a"; g.fillText(`Projectile "${W.wpn.projectileSpecId}" not found: drawing a default streak.`, 10 * d, cv.height - 10 * d); }
}

// ---------------------------------------------------------------- UI glue
function weaponSimHtml() {
  return `<details id="wsim-box" class="wsim" ${SIM.open ? "open" : ""}><summary><h3 style="display:inline">Firing preview</h3>
    <span class="muted" style="font-size:12px"> · approximate · ${SIM.open ? "click to hide" : "click to show"}</span></summary>
    <div class="wsim-note"><b>⚠ Approximation only.</b> Useful for checking the weapon's sprites and animation: recoil, glow, animated frames,
      barrel order, muzzle flash and smoke, projectile/missile/beam look, and rough fire timing. It is <b>not</b> the game's renderer:
      particle effects, beam textures and missile guidance are simplified, and scripted effects (onHit, everyFrame, beamEffect) aren't run.
      Always check the final result in game.</div>
    <div class="btnrow" style="margin:6px 0">
      <button id="wsim-fire" class="${SIM.on ? "primary" : ""}">${SIM.on ? "■ Hold fire" : "▶ Fire"}</button>
      <button id="wsim-reset" title="Clear shots, refill ammo">Reset</button>
      <label class="muted">Speed <select id="wsim-speed">${[0.1, 0.25, 0.5, 1].map((x) => `<option value="${x}"${x === SIM.speed ? " selected" : ""}>${x}×</option>`).join("")}</select></label>
      <label class="muted">Zoom <input type="range" id="wsim-zoom" min="-3" max="2" step="0.05" value="${Math.log2((SIM.zoom || devicePixelRatio) / devicePixelRatio)}" style="width:120px"></label>
      <button id="wsim-fit" class="${SIM.fit ? "active" : ""}">Fit range</button>
      <label class="muted"><input type="checkbox" id="wsim-target" ${SIM.target ? "checked" : ""}> Target dummy (drag it)</label>
      <label class="muted" title="Play the weapon's fireSoundOne/fireSoundTwo from sounds.json"><input type="checkbox" id="wsim-sound" ${SIM.sound ? "checked" : ""}> Sound</label>
    </div>
    <canvas id="wsim" style="width:100%;height:300px;display:block;border-radius:6px;border:1px solid var(--line);cursor:default"></canvas>
  </details>`;
}
function attachWeaponSim() {
  const box = $("#wsim-box"); if (!box) return;
  if (SIM.id !== W.id || !SIM.st) { SIM.id = W.id; SIM.targetDist = 0; SIM.firstFire = null; simReset(); }
  box.addEventListener("toggle", () => {
    if (box.open && !SIM.open) { simReset(); SIM.firstFire = null; }
    SIM.open = box.open;
    const hint = box.querySelector("summary .muted"); if (hint) hint.textContent = ` · approximate · ${box.open ? "click to hide" : "click to show"}`;
  });
  $("#wsim-fire").onclick = () => { SIM.on = !SIM.on; const b = $("#wsim-fire"); b.textContent = SIM.on ? "■ Hold fire" : "▶ Fire"; b.classList.toggle("primary", SIM.on); };
  $("#wsim-reset").onclick = () => { simReset(); SIM.firstFire = null; };
  $("#wsim-speed").onchange = (e) => (SIM.speed = +e.target.value);
  $("#wsim-zoom").oninput = (e) => { SIM.fit = false; SIM.zoom = Math.pow(2, +e.target.value) * devicePixelRatio; $("#wsim-fit").classList.remove("active"); };
  $("#wsim-fit").onclick = () => { SIM.fit = true; $("#wsim-fit").classList.add("active"); };
  $("#wsim-target").onchange = (e) => (SIM.target = e.target.checked);
  $("#wsim-sound").onchange = (e) => (SIM.sound = e.target.checked);
  const cv = $("#wsim");
  const worldX = (e) => { const r = cv.getBoundingClientRect(), sp = simSpec(), v = simView(cv, sp); return ((e.clientX - r.left) * (cv.width / r.width) - v.ox) / v.s; };
  cv.onmousedown = (e) => { const sp = simSpec(), tg = simTarget(sp); if (tg && Math.abs(worldX(e) - tg.x) < tg.r * 1.2) { SIM.drag = true; e.preventDefault(); } };
  cv.onmousemove = (e) => {
    const sp = simSpec(), tg = simTarget(sp);
    if (SIM.drag) SIM.targetDist = Math.max(40, worldX(e));
    cv.style.cursor = SIM.drag || (tg && Math.abs(worldX(e) - tg.x) < tg.r * 1.2) ? "ew-resize" : "default";
  };
  window.addEventListener("mouseup", () => (SIM.drag = false));
  cv.onwheel = (e) => { e.preventDefault(); SIM.fit = false; SIM.zoom = (SIM.zoom || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15); $("#wsim-fit").classList.remove("active"); $("#wsim-zoom").value = Math.log2(SIM.zoom / devicePixelRatio); };
  if (!SIM.raf) { SIM.last = performance.now(); SIM.raf = requestAnimationFrame(simLoop); }
}
function simLoop(now) {
  SIM.raf = requestAnimationFrame(simLoop);
  const cv = document.getElementById("wsim");
  const dtReal = Math.min(0.05, (now - SIM.last) / 1000); SIM.last = now;
  if (!cv || !W || !cv.offsetParent || !$("#wsim-box").open) { if (typeof SND !== "undefined" && SND.loops.beam && SND.loops.beam.pause) { SND.loops.beam.pause(); SND.loops.beam = null; } return; } // hidden: pause
  const dpr = devicePixelRatio || 1, wpx = Math.round(cv.clientWidth * dpr), hpx = Math.round(cv.clientHeight * dpr);
  if (cv.width !== wpx || cv.height !== hpx) { cv.width = wpx; cv.height = hpx; }
  let sp; try { sp = simSpec(); } catch (e) { return; }
  const dt = dtReal * SIM.speed;
  // run in small steps so fast weapons stay accurate at low frame rates
  const n = Math.max(1, Math.ceil(dt / 0.01));
  for (let i = 0; i < n; i++) {
    simStep(dt / n, sp); simUpdateShots(dt / n);
    SIM.st.scroll = (SIM.st.scroll || 0) + simN(sp.w.textureScrollSpeed, 0) * (dt / n);
  }
  if (SIM.on && SIM.firstFire == null && SIM.st.shots > 0) SIM.firstFire = SIM.st.time;
  if (!SIM.on) SIM.firstFire = null;
  simDraw(cv, sp);
  if (typeof simBeamSound === "function") simBeamSound(sp);
}

document.head.insertAdjacentHTML("beforeend", `<style>
.wsim > summary { cursor: pointer; }
.wsim-note { margin: 6px 0; padding: 7px 10px; border: 1px solid #8a6a1f; background: #2b230f; color: #f1dca4; border-radius: 6px; font-size: 12px; line-height: 1.45; }
</style>`);
