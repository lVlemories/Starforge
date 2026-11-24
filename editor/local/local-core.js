// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Starforge, browser (no-Java) version: everything the Java server does, done inside the page.
// Files are read and written through a folder the user picks (File System Access API, Chrome/Edge).
// The editor's own UI is unchanged: api("/api/...") calls are answered by FORGE_LOCAL.route below.

window.FORGE_LOCAL = (() => {
  const L = {};

  // ================================================================ file system (paths relative to the Starsector folder)
  const FS = { root: null, name: "", dirs: new Map() };
  L.FS = FS;

  function parts(rel) {
    const out = [];
    for (const s of String(rel || "").replace(/\\/g, "/").split("/")) {
      if (!s || s === ".") continue;
      if (s === "..") throw new Error("Bad path: " + rel);
      out.push(s);
    }
    return out;
  }
  const join = (...xs) => parts(xs.filter((x) => x != null && x !== "").join("/")).join("/");
  /** Paths the UI sees: "<folder name>/<relative path>" (like the Java version's absolute paths). */
  const abs = (rel) => (rel ? FS.name + "/" + rel : FS.name);
  function toRel(p) {
    const s = String(p == null ? "" : p).replace(/\\/g, "/");
    if (s === FS.name) return "";
    if (s.startsWith(FS.name + "/")) return parts(s.slice(FS.name.length + 1)).join("/");
    throw new Error("Outside the Starsector folder");
  }
  L.abs = abs; L.toRel = toRel;

  // a limit on simultaneous reads keeps big mod lists from flooding the browser
  function limiter(n) {
    let active = 0; const q = [];
    const next = () => { if (active >= n || !q.length) return; active++; const [fn, ok, bad] = q.shift(); fn().then(ok, bad).finally(() => { active--; next(); }); };
    return (fn) => new Promise((ok, bad) => { q.push([fn, ok, bad]); next(); });
  }
  const io = limiter(48);

  /** Directory listing, cached: lower-case name -> {name, kind, handle}. Lookups are case-insensitive like Windows. */
  function listing(ps) {
    const key = ps.join("/").toLowerCase();
    let p = FS.dirs.get(key);
    if (!p) {
      p = (async () => {
        const h = await dirHandle(ps, false);
        const m = new Map();
        if (!h) return m;
        await io(async () => { for await (const [name, hd] of h.entries()) m.set(name.toLowerCase(), { name, kind: hd.kind, handle: hd }); });
        return m;
      })();
      FS.dirs.set(key, p);
      p.catch(() => FS.dirs.delete(key));
    }
    return p;
  }
  async function dirHandle(ps, create) {
    let h = FS.root;
    for (let i = 0; i < ps.length; i++) {
      const m = await listing(ps.slice(0, i));
      const e = m.get(ps[i].toLowerCase());
      if (e && e.kind === "directory") { h = e.handle; continue; }
      if (!create) return null;
      if (e) throw new Error(ps.slice(0, i + 1).join("/") + " is a file, not a folder");
      h = await h.getDirectoryHandle(ps[i], { create: true });
      m.set(ps[i].toLowerCase(), { name: ps[i], kind: "directory", handle: h });
    }
    return h;
  }
  async function entry(rel) {
    const ps = parts(rel);
    if (!ps.length) return { name: FS.name, kind: "directory", handle: FS.root };
    const m = await listing(ps.slice(0, -1));
    return m.get(ps[ps.length - 1].toLowerCase()) || null;
  }
  /** The path with the real letter case of every part that exists. */
  async function realRel(rel) {
    const ps = parts(rel), out = [];
    for (let i = 0; i < ps.length; i++) {
      const m = await listing(ps.slice(0, i));
      const e = m.get(ps[i].toLowerCase());
      if (!e) { out.push(...ps.slice(i)); break; }
      out.push(e.name);
    }
    return out.join("/");
  }
  FS.isFile = async (rel) => { const e = await entry(rel).catch(() => null); return !!e && e.kind === "file"; };
  FS.isDir = async (rel) => { const e = await entry(rel).catch(() => null); return !!e && e.kind === "directory"; };
  FS.file = async (rel) => {
    const e = await entry(rel);
    if (!e || e.kind !== "file") throw new Error("File not found: " + rel);
    return io(() => e.handle.getFile());
  };
  FS.text = async (rel) => (await FS.file(rel)).text();
  FS.bytes = async (rel) => new Uint8Array(await (await FS.file(rel)).arrayBuffer());
  /** Child entries of a folder (empty if it doesn't exist), with their real names. */
  FS.list = async (rel) => { const ps = parts(rel); if (!(await dirHandle(ps, false))) return []; return [...(await listing(ps)).values()]; };
  /** Every file under a folder; depth like Java's Files.walk (1 = direct children). Calls back with the file's relative path. */
  FS.walk = async (rel, depth, cb) => {
    const base = await realRel(rel);
    const go = async (r, left) => {
      const kids = await FS.list(r);
      const subs = [];
      for (const k of kids) {
        const kr = r ? r + "/" + k.name : k.name;
        if (k.kind === "file") cb(kr, k); else if (left > 1) subs.push(go(kr, left - 1));
      }
      await Promise.all(subs);
    };
    if (await FS.isDir(base)) await go(base, depth == null ? Infinity : depth);
  };
  /** Writes text or bytes, creating folders as needed. Keeps the existing file's letter case. */
  FS.write = async (rel, data) => {
    const ps = parts(await realRel(rel));
    const dir = await dirHandle(ps.slice(0, -1), true);
    const m = await listing(ps.slice(0, -1));
    const name = ps[ps.length - 1];
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try { await w.write(data); } catch (e) { await w.abort().catch(() => {}); throw e; }
    await w.close();
    m.set(name.toLowerCase(), { name, kind: "file", handle: fh });
  };
  FS.remove = async (rel, recursive) => {
    const ps = parts(await realRel(rel));
    const dir = await dirHandle(ps.slice(0, -1), false);
    if (!dir) return;
    await dir.removeEntry(ps[ps.length - 1], { recursive: !!recursive });
    (await listing(ps.slice(0, -1))).delete(ps[ps.length - 1].toLowerCase());
    for (const k of [...FS.dirs.keys()]) if (k === ps.join("/").toLowerCase() || k.startsWith(ps.join("/").toLowerCase() + "/")) FS.dirs.delete(k);
  };
  FS.reset = () => FS.dirs.clear();
  FS.real = realRel;
  FS.mkdir = async (rel) => { await dirHandle(parts(await realRel(rel)), true); };

  // ================================================================ lenient JSON (what Starsector accepts)
  const Json = {};
  const NUM = /^[+-]?(NaN|Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?)$/;
  Json.parse = (text) => {
    let s = String(text);
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const n = s.length;
    let i = 0;
    const err = (m) => { let line = 1; for (let k = 0; k < Math.min(i, n); k++) if (s.charCodeAt(k) === 10) line++; return new Error(m + " at line " + line); };
    const isWs = (c) => c === 32 || (c >= 9 && c <= 13) || (c >= 28 && c <= 31);
    const ws = () => {
      while (i < n) {
        const c = s.charCodeAt(i);
        if (isWs(c)) i++;
        else if (c === 35) { while (i < n && s.charCodeAt(i) !== 10) i++; } // #
        else if (c === 47 && s.charCodeAt(i + 1) === 47) { while (i < n && s.charCodeAt(i) !== 10) i++; } // //
        else if (c === 47 && s.charCodeAt(i + 1) === 42) { const e = s.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; }
        else break;
      }
    };
    const str = (q) => {
      let b = "";
      i++;
      let st = i;
      while (i < n) {
        const c = s[i];
        if (c === q) { b += s.slice(st, i); i++; return b; }
        if (c === "\\" && i + 1 < n) {
          b += s.slice(st, i);
          const e = s[i + 1]; i += 2;
          if (e === "n") b += "\n"; else if (e === "t") b += "\t"; else if (e === "r") b += "\r"; else if (e === "b") b += "\b"; else if (e === "f") b += "\f";
          else if (e === "u") { if (i + 4 <= n) { b += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); i += 4; } }
          else b += e;
          st = i;
        } else i++;
      }
      throw err("Unterminated string");
    };
    const bare = () => {
      const st = i;
      while (i < n) {
        const c = s[i];
        if (c === "," || c === "}" || c === "]" || c === "\n" || c === "\r" || c === "#") break;
        if (c === "/" && (s[i + 1] === "/" || s[i + 1] === "*")) break;
        i++;
      }
      const t = s.slice(st, i).trim();
      if (!t) throw err("Unexpected character '" + s[st] + "'");
      if (t === "true") return true;
      if (t === "false") return false;
      if (t === "null") return null;
      if (NUM.test(t)) return Number(t.replace(/[fFdD]$/, ""));
      return t;
    };
    const value = () => {
      if (i >= n) throw err("Unexpected end");
      const c = s[i];
      if (c === "{") {
        const m = Object.create(null);
        i++;
        for (;;) {
          ws();
          if (i >= n) throw err("Unterminated object");
          const d = s[i];
          if (d === "}") { i++; return m; }
          if (d === ",") { i++; continue; }
          let key;
          if (d === '"' || d === "'") key = str(d);
          else { const k0 = i; while (i < n && ":,}\n".indexOf(s[i]) < 0) i++; key = s.slice(k0, i).trim(); }
          ws();
          if (i < n && (s[i] === ":" || s[i] === "=")) i++;
          else throw err("Expected ':' after key '" + key + "'");
          ws();
          m[key] = value();
        }
      }
      if (c === "[") {
        const a = [];
        i++;
        for (;;) {
          ws();
          if (i >= n) throw err("Unterminated array");
          const d = s[i];
          if (d === "]") { i++; return a; }
          if (d === ",") { i++; continue; }
          a.push(value());
        }
      }
      if (c === '"' || c === "'") return str(c);
      return bare();
    };
    ws();
    return value();
  };
  const isObj = (o) => o != null && typeof o === "object" && !Array.isArray(o);
  Json.obj = (o) => (isObj(o) ? o : null);
  Json.arr = (o) => (Array.isArray(o) ? o : null);
  const numStr = (d) => (Number.isFinite(d) && d === Math.round(d) && Math.abs(d) < 1e15 ? String(d) : String(d));
  /** Same layout as the Java version's pretty printer (4 spaces, arrays on one line). */
  Json.pretty = (o) => {
    let b = "";
    const nl = (depth) => { b += "\n" + " ".repeat(4 * depth); };
    const w = (v, depth) => {
      if (v == null) b += "null";
      else if (typeof v === "string") b += JSON.stringify(v);
      else if (typeof v === "number") b += numStr(v);
      else if (typeof v === "boolean") b += String(v);
      else if (Array.isArray(v)) { b += "["; v.forEach((x, k) => { if (k) b += ", "; w(x, depth + 1); }); b += "]"; }
      else if (typeof v === "object") {
        const ks = Object.keys(v);
        b += "{";
        ks.forEach((k, idx) => { if (idx) b += ","; nl(depth + 1); b += JSON.stringify(k) + ": "; w(v[k], depth + 1); });
        if (ks.length) nl(depth);
        b += "}";
      } else b += JSON.stringify(String(v));
    };
    w(o, 0);
    return b;
  };
  L.Json = Json;

  // ================================================================ CSV (quoted multi-line fields, '#' rows skipped)
  const Csv = {};
  /** Records with their text spans (start inclusive, end exclusive, including the newline). */
  Csv.spans = (text) => {
    const out = [];
    let row = [], f = "", q = false;
    let i = text.charCodeAt(0) === 0xfeff ? 1 : 0, start = i;
    const n = text.length;
    for (; i < n; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = "";
        out.push({ cells: row, start, end: i + 1 });
        row = []; start = i + 1;
      } else f += c;
    }
    if (f.length || row.length) { row.push(f); out.push({ cells: row, start, end: n }); }
    return out;
  };
  Csv.rows = (text) => Csv.spans(text).map((r) => r.cells);
  Csv.quote = (v) => {
    if (v == null || v === "") return "";
    v = String(v);
    const need = /[,"\n\r]/.test(v) || v.startsWith(" ") || v.endsWith(" ") || v.startsWith("#");
    return need ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  Csv.line = (header, row) => header.map((h) => { const v = row[String(h).trim()]; return Csv.quote(v == null ? "" : String(v)); }).join(",");
  /** Rows as header-keyed objects; rows whose key column is empty or starts with '#' are skipped. */
  Csv.records = (text, key) => {
    const rows = Csv.rows(text);
    const out = [];
    if (!rows.length) return out;
    const header = rows[0];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r], m = {};
      for (let c = 0; c < header.length; c++) { const h = header[c].trim(); if (h) m[h] = c < row.length ? row[c] : ""; }
      const k = m[key];
      if (k == null || !k.trim() || k.trim().startsWith("#")) continue;
      out.push(m);
    }
    return out;
  };
  L.Csv = Csv;

  // continued in local-data.js
  return L;
})();
