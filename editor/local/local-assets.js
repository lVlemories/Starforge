// Starforge: a Starsector ship, weapon and mod editor.
// Copyright (C) 2026 Claude
// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
// License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
// version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
"use strict";
// Browser version: images and sounds. The editor writes asset(path) into <img src> and new Audio(); here asset()
// gives a marker URL (a 1x1 transparent GIF with the game path after #) and the real file is swapped in as a blob: URL.
(() => {
  const L = window.FORGE_LOCAL;
  const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  const MARK = GIF + "#forge-asset=";
  const MISSING = "data:,missing"; // fails to decode, so the element gets its normal error event
  window.FORGE_ASSET = (p) => MARK + encodeURIComponent(String(p).replace(/\\/g, "/"));

  function hook(proto) {
    const d = Object.getOwnPropertyDescriptor(proto, "src");
    Object.defineProperty(proto, "src", {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) {
        const s = String(v);
        if (!s.startsWith(MARK)) { this.__forgeWant = null; this.__forgePending = null; d.set.call(this, v); return; }
        const rel = decodeURIComponent(s.slice(MARK.length));
        this.__forgeWant = rel;
        const known = L.assetKnown(rel);
        if (known !== undefined) { this.__forgePending = null; d.set.call(this, known || MISSING); return; }
        this.__forgePending = L.assetUrl(rel).then((u) => { if (this.__forgeWant === rel) d.set.call(this, u || MISSING); });
      },
    });
  }
  hook(HTMLImageElement.prototype);
  hook(HTMLMediaElement.prototype);

  // play() right after new Audio(asset(..)) waits for the file to be found
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { return this.__forgePending ? this.__forgePending.then(() => play.call(this)) : play.call(this); };
  const NativeAudio = window.Audio;
  function Audio(src) { const a = new NativeAudio(); if (src !== undefined) a.src = src; return a; }
  Audio.prototype = NativeAudio.prototype;
  window.Audio = Audio;

  // <img src="…marker…"> written as HTML: swap in the real file
  const fix = (el) => { const a = el.getAttribute("src"); if (a && a.startsWith(MARK)) el.src = a; };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") { if (m.target.tagName === "IMG" || m.target.tagName === "AUDIO") fix(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === "IMG") fix(n);
        else if (n.firstElementChild) for (const im of n.querySelectorAll('img[src^="data:image/gif;base64"]')) fix(im);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
})();
