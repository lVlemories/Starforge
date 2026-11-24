/*
 * Starforge: a Starsector ship, weapon and mod editor.
 * Copyright (C) 2026 Claude
 * SPDX-License-Identifier: GPL-3.0-or-later
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
 * version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
 */
package forge;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Arrays;
import java.util.Locale;
import java.util.TreeMap;
import java.util.stream.Stream;

/**
 * Loads vanilla + enabled mods the way the editor needs them: merged CSVs (later sources
 * replace earlier rows by id), indexed .ship/.skin/.variant/.wpn files, and asset lookup
 * where mods override core.
 */
public final class GameData {
    public static final class Source {
        public final String id, name, version;
        public final Path root;
        public final boolean core;
        public boolean enabled = true;

        public Source(String id, String name, String version, Path root, boolean core) {
            this.id = id; this.name = name; this.version = version; this.root = root; this.core = core;
        }

        public Map<String, Object> toJson() {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            m.put("id", id); m.put("name", name); m.put("version", version);
            m.put("root", root.toString()); m.put("core", core); m.put("enabled", enabled);
            return m;
        }
    }

    public final Path gameDir, coreDir, modsDir, commonDir;
    public final List<Source> sources = new ArrayList<Source>();
    public final List<String> warnings = new ArrayList<String>();

    public final Map<String, Map<String, Object>> ships = new LinkedHashMap<String, Map<String, Object>>();
    public final Map<String, Map<String, Object>> hullmods = new LinkedHashMap<String, Map<String, Object>>();
    public final Map<String, Map<String, Object>> weapons = new LinkedHashMap<String, Map<String, Object>>();
    public final Map<String, Map<String, Object>> wings = new LinkedHashMap<String, Map<String, Object>>();
    public final Map<String, Map<String, Object>> systems = new LinkedHashMap<String, Map<String, Object>>();
    public final Map<String, Map<String, Object>> descriptions = new LinkedHashMap<String, Map<String, Object>>();
    /** hullId -> entry for .ship and .skin files (last source wins). */
    public final Map<String, Map<String, Object>> hullFiles = new LinkedHashMap<String, Map<String, Object>>();
    /** projectile spec id -> {path, source} for data/weapons/proj/*.proj */
    public final Map<String, Map<String, Object>> projFiles = new LinkedHashMap<String, Map<String, Object>>();
    /** variantId -> entry. */
    public final Map<String, Map<String, Object>> variants = new LinkedHashMap<String, Map<String, Object>>();
    /** variantId -> {weapons, mods, wings, modules} referenced by that variant (for "where used"). */
    public final Map<String, Map<String, List<String>>> variantRefs = new HashMap<String, Map<String, List<String>>>();
    /** hullId -> {mods, weapons, wings} built into the hull or skin file. */
    public final Map<String, Map<String, List<String>>> hullRefs = new HashMap<String, Map<String, List<String>>>();
    /** Relative .faction path -> the parts contributed by each source, in load order (the game merges them). */
    public final Map<String, List<Map<String, Object>>> factionParts = new TreeMap<String, List<Map<String, Object>>>();
    /** Merged default_ship_roles.json: role -> {variantId -> weight}. */
    public final Map<String, Map<String, Object>> roles = new LinkedHashMap<String, Map<String, Object>>();
    /** sound id -> [{file, volume, pitch}] from the merged sounds.json files. */
    public final Map<String, List<Object>> sounds = new HashMap<String, List<Object>>();
    /** ship system id -> {path, source} of its .system file. */
    public final Map<String, Map<String, Object>> systemFiles = new LinkedHashMap<String, Map<String, Object>>();

    /** "enabled" (enabled_mods.json), "all" (every installed mod) or "custom" (the folders in selectedFolders). */
    public final String modMode;
    public final java.util.Set<String> selectedFolders;
    public final Map<String, Object> engineStyles = new LinkedHashMap<String, Object>();
    public final Map<String, Object> hullStyles = new LinkedHashMap<String, Object>();

    public GameData(Path gameDir) { this(gameDir, "all", null); }

    public GameData(Path gameDir, String modMode, java.util.Collection<String> selectedFolders) {
        this.modMode = modMode == null ? "all" : modMode;
        this.selectedFolders = new java.util.TreeSet<String>(String.CASE_INSENSITIVE_ORDER);
        if (selectedFolders != null) this.selectedFolders.addAll(selectedFolders);
        this.gameDir = gameDir;
        Path[] l = layout(gameDir);
        this.coreDir = l[0];
        this.modsDir = l[1];
        this.commonDir = l[2];
    }

    /**
     * Finds the game data, mods and saves/common folders for the three install layouts:
     * Windows (starsector-core/), Linux (data/ next to starsector.sh) and macOS (Starsector.app/Contents/Resources/Java/).
     * Returns null for the core folder when none is found.
     */
    public static Path[] layout(Path dir) {
        Path core = null, root = dir;
        Path[] cores = { dir.resolve("starsector-core"), dir, dir.resolve("Contents/Resources/Java"), dir.resolve("Starsector.app/Contents/Resources/Java") };
        // the game's own jar tells a real install apart from a mod folder (mods also have data/hulls and graphics)
        for (Path c : cores) if (Files.isDirectory(c.resolve("data/hulls")) && Files.isDirectory(c.resolve("graphics"))
                && (Files.isRegularFile(c.resolve("starfarer.api.jar")) || Files.isRegularFile(c.resolve("starfarer_obf.jar")))) { core = c; break; }
        if (core != null && core.endsWith(Paths.get("Contents/Resources/Java"))) root = core.getParent().getParent().getParent(); // the .app
        Path mods = root.resolve("mods");
        if (!Files.isDirectory(mods) && root != dir && Files.isDirectory(dir.resolve("mods"))) mods = dir.resolve("mods");
        Path common = root.resolve("saves").resolve("common");
        return new Path[] { core, mods, common };
    }

    public static String read(Path p) throws IOException {
        return new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------ loading

    public void load() {
        resolveSources();
        // Parse each source in parallel into its own GameData shard, then merge in load order
        // so later sources still replace earlier ones exactly as in a sequential load.
        List<java.util.concurrent.Future<GameData>> parts = new ArrayList<java.util.concurrent.Future<GameData>>();
        java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(
                Math.max(2, Runtime.getRuntime().availableProcessors()));
        for (final Source src : sources) {
            parts.add(pool.submit(() -> {
                GameData g = new GameData(gameDir, modMode, selectedFolders);
                g.mergeCsv(src, "data/hulls/ship_data.csv", g.ships, "id");
                g.mergeCsv(src, "data/hullmods/hull_mods.csv", g.hullmods, "id");
                g.mergeCsv(src, "data/weapons/weapon_data.csv", g.weapons, "id");
                g.mergeCsv(src, "data/hulls/wing_data.csv", g.wings, "id");
                g.mergeCsv(src, "data/shipsystems/ship_systems.csv", g.systems, "id");
                g.mergeDescriptions(src);
                g.indexHulls(src);
                g.indexVariants(src);
                g.indexWeaponFiles(src);
                g.indexProj(src);
                g.mergeConfig(src, "data/config/engine_styles.json", g.engineStyles);
                g.mergeConfig(src, "data/config/hull_styles.json", g.hullStyles);
                g.indexFactions(src);
                g.indexSounds(src);
                g.indexSystemFiles(src);
                return g;
            }));
        }
        pool.shutdown();
        for (java.util.concurrent.Future<GameData> f : parts) {
            try {
                GameData g = f.get();
                absorb(g.ships, ships);
                absorb(g.hullmods, hullmods);
                absorb(g.weapons, weapons);
                absorb(g.wings, wings);
                absorb(g.systems, systems);
                descriptions.putAll(g.descriptions);
                engineStyles.putAll(g.engineStyles);
                hullStyles.putAll(g.hullStyles);
                hullFiles.putAll(g.hullFiles);
                projFiles.putAll(g.projFiles);
                variants.putAll(g.variants);
                variantRefs.putAll(g.variantRefs);
                hullRefs.putAll(g.hullRefs);
                for (Map.Entry<String, List<Map<String, Object>>> e : g.factionParts.entrySet())
                    factionParts.computeIfAbsent(e.getKey(), k -> new ArrayList<Map<String, Object>>()).addAll(e.getValue());
                for (Map.Entry<String, Map<String, Object>> e : g.roles.entrySet())
                    roles.computeIfAbsent(e.getKey(), k -> new LinkedHashMap<String, Object>()).putAll(e.getValue());
                sounds.putAll(g.sounds);
                systemFiles.putAll(g.systemFiles);
                warnings.addAll(g.warnings);
            } catch (Exception e) {
                warnings.add("Loading failed for a source: " + e);
            }
        }
        weapons.values().removeIf(r -> Boolean.TRUE.equals(r.get("_wpnOnly")));
        attachHullmodExport();
    }

    private static void absorb(Map<String, Map<String, Object>> from, Map<String, Map<String, Object>> into) {
        for (Map.Entry<String, Map<String, Object>> e : from.entrySet()) {
            Map<String, Object> prev = into.get(e.getKey());
            Map<String, Object> row = e.getValue();
            if (Boolean.TRUE.equals(row.get("_wpnOnly"))) {
                // A .wpn without its own CSV row: attach to the existing row, or hold until one arrives.
                if (prev != null) {
                    for (String k : new String[] {"_wpn", "_size", "_mountType", "_turretSprite", "_hardpointSprite"})
                        if (row.containsKey(k)) prev.put(k, row.get(k));
                } else into.put(e.getKey(), row);
                continue;
            }
            if (prev != null && Boolean.TRUE.equals(prev.get("_wpnOnly"))) {
                for (Map.Entry<String, Object> pe : prev.entrySet())
                    if (pe.getKey().startsWith("_") && !row.containsKey(pe.getKey())) row.put(pe.getKey(), pe.getValue());
                row.remove("_wpnOnly");
                into.put(e.getKey(), row);
                continue;
            }
            if (prev != null) {
                List<Object> over = new ArrayList<Object>();
                Object po = prev.get("_overrides");
                if (po instanceof List) over.addAll((List<?>) po);
                over.add(prev.get("_source"));
                row.put("_overrides", over);
                // Keep .wpn details found earlier if this source only replaced the CSV row.
                for (String k : new String[] {"_wpn", "_size", "_mountType", "_turretSprite", "_hardpointSprite"})
                    if (!row.containsKey(k) && prev.containsKey(k)) row.put(k, prev.get(k));
            }
            into.put(e.getKey(), row);
        }
    }

    private void resolveSources() {
        sources.add(new Source("starsector-core", "Starsector", "", coreDir, true));
        List<String> enabled = new ArrayList<String>();
        if (!Files.isDirectory(modsDir)) return; // plain vanilla install without a mods folder: nothing else to load
        if (Files.isRegularFile(modsDir.resolve("enabled_mods.json"))) try {
            Map<String, Object> em = Json.obj(Json.parse(read(modsDir.resolve("enabled_mods.json"))));
            List<Object> list = em == null ? null : Json.arr(em.get("enabledMods"));
            if (list != null) for (Object o : list) enabled.add(String.valueOf(o));
        } catch (Exception e) {
            warnings.add("Could not read mods/enabled_mods.json: " + e.getMessage());
        }

        // id -> candidate folders (folders whose mod_info.json is renamed to .disabled are ignored, like the game does)
        Map<String, List<Source>> byId = new HashMap<String, List<Source>>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(modsDir)) {
            for (Path dir : ds) {
                Path info = dir.resolve("mod_info.json");
                if (!Files.isDirectory(dir) || !Files.isRegularFile(info)) continue;
                try {
                    Map<String, Object> mi = Json.obj(Json.parse(read(info)));
                    if (mi == null || mi.get("id") == null) continue;
                    String id = String.valueOf(mi.get("id"));
                    Object v = mi.get("version");
                    String version = v instanceof Map ? versionString(Json.obj(v)) : (v == null ? "" : String.valueOf(v));
                    Source s = new Source(id, String.valueOf(mi.getOrDefault("name", id)), version, dir, false);
                    byId.computeIfAbsent(id, k -> new ArrayList<Source>()).add(s);
                } catch (Exception e) {
                    warnings.add("Unreadable mod_info.json in " + dir.getFileName() + ": " + e.getMessage());
                }
            }
        } catch (IOException e) {
            warnings.add("Could not list mods folder: " + e.getMessage());
        }

        List<Source> mods = new ArrayList<Source>();
        List<String> wanted = new ArrayList<String>();
        if ("custom".equals(modMode)) {
            // only the chosen folders; ids with no chosen folder are skipped
            for (Map.Entry<String, List<Source>> e : byId.entrySet()) {
                e.getValue().removeIf(x -> !selectedFolders.contains(x.root.getFileName().toString()));
                if (!e.getValue().isEmpty()) wanted.add(e.getKey());
            }
            for (String f : selectedFolders) {
                boolean found = false;
                for (List<Source> c : byId.values()) for (Source x : c) if (x.root.getFileName().toString().equalsIgnoreCase(f)) found = true;
                if (!found) warnings.add("Selected mod folder '" + f + "' is no longer in the mods folder (or has no active mod_info.json).");
            }
        } else {
            wanted.addAll(enabled);
            if ("all".equals(modMode)) for (String id : byId.keySet()) if (!wanted.contains(id)) wanted.add(id);
        }
        for (String id : wanted) {
            List<Source> c = byId.get(id);
            if (c == null) {
                warnings.add("Enabled mod '" + id + "' has no folder with an active mod_info.json.");
                continue;
            }
            if (c.size() > 1) {
                StringBuilder b = new StringBuilder();
                for (Source s : c) b.append(s.root.getFileName()).append("; ");
                warnings.add("Mod '" + id + "' has " + c.size() + " active folders (" + b + "). Using the newest version; move the others out of the mods folder.");
            }
            Source chosen = c.get(0);
            for (Source x : c) if (compareVersions(x.version, chosen.version) > 0 || (compareVersions(x.version, chosen.version) == 0 && x.root.getFileName().toString().compareToIgnoreCase(chosen.root.getFileName().toString()) > 0)) chosen = x;
            chosen.enabled = enabled.contains(id);
            mods.add(chosen);
        }
        // Approximates the game's order (alphabetical by mod id); vanilla always first.
        Collections.sort(mods, (a, b) -> a.id.compareToIgnoreCase(b.id));
        sources.addAll(mods);
    }

    /** Every mod folder with an active mod_info.json (cheap scan, for the mod picker). */
    public static List<Object> scanMods(Path modsDir) {
        List<String> enabled = new ArrayList<String>();
        try {
            Map<String, Object> em = Json.obj(Json.parse(read(modsDir.resolve("enabled_mods.json"))));
            List<Object> list = em == null ? null : Json.arr(em.get("enabledMods"));
            if (list != null) for (Object o : list) enabled.add(String.valueOf(o));
        } catch (Exception ignored) {}
        List<Object> out = new ArrayList<Object>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(modsDir)) {
            for (Path dir : ds) {
                Path info = dir.resolve("mod_info.json");
                if (!Files.isDirectory(dir) || !Files.isRegularFile(info)) continue;
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("folder", dir.getFileName().toString());
                try {
                    Map<String, Object> mi = Json.obj(Json.parse(read(info)));
                    if (mi == null || mi.get("id") == null) continue;
                    String id = String.valueOf(mi.get("id"));
                    Object v = mi.get("version");
                    m.put("id", id);
                    m.put("name", String.valueOf(mi.getOrDefault("name", id)));
                    m.put("version", v instanceof Map ? versionString(Json.obj(v)) : (v == null ? "" : String.valueOf(v)));
                    m.put("gameVersion", mi.get("gameVersion") == null ? "" : String.valueOf(mi.get("gameVersion")));
                    m.put("author", mi.get("author") == null ? "" : String.valueOf(mi.get("author")));
                    m.put("utility", "true".equalsIgnoreCase(String.valueOf(mi.get("utility"))));
                    m.put("totalConversion", "true".equalsIgnoreCase(String.valueOf(mi.get("totalConversion"))));
                    List<Object> deps = new ArrayList<Object>();
                    List<Object> dl = Json.arr(mi.get("dependencies"));
                    if (dl != null) for (Object o : dl) { Map<String, Object> dm = Json.obj(o); if (dm != null && dm.get("id") != null) deps.add(String.valueOf(dm.get("id"))); }
                    m.put("dependencies", deps);
                    m.put("enabledInGame", enabled.contains(id));
                    m.put("hasData", Files.isDirectory(dir.resolve("data")) || Files.isDirectory(dir.resolve("graphics")));
                } catch (Exception e) {
                    m.put("error", "Unreadable mod_info.json: " + e.getMessage());
                }
                out.add(m);
            }
        } catch (IOException ignored) {}
        return out;
    }

    /** Compares versions like 1.10.2 vs 1.9 numerically, part by part (letters compared as text). */
    static int compareVersions(String a, String b) {
        String[] x = (a == null ? "" : a).split("[^0-9A-Za-z]+"), y = (b == null ? "" : b).split("[^0-9A-Za-z]+");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            String p = i < x.length ? x[i] : "0", q = i < y.length ? y[i] : "0";
            java.util.regex.Matcher mp = java.util.regex.Pattern.compile("^(\\d*)(.*)$").matcher(p), mq = java.util.regex.Pattern.compile("^(\\d*)(.*)$").matcher(q);
            mp.find(); mq.find();
            long np = mp.group(1).isEmpty() ? 0 : Long.parseLong(mp.group(1).length() > 15 ? mp.group(1).substring(0, 15) : mp.group(1));
            long nq = mq.group(1).isEmpty() ? 0 : Long.parseLong(mq.group(1).length() > 15 ? mq.group(1).substring(0, 15) : mq.group(1));
            if (np != nq) return np < nq ? -1 : 1;
            int c = mp.group(2).compareToIgnoreCase(mq.group(2));
            if (c != 0) return c;
        }
        return 0;
    }

    private static String versionString(Map<String, Object> v) {
        return fmt(v.get("major")) + "." + fmt(v.get("minor")) + "." + fmt(v.get("patch"));
    }

    private static String fmt(Object o) {
        if (o instanceof Double && ((Double) o) == Math.rint((Double) o)) return String.valueOf(((Double) o).longValue());
        return o == null ? "0" : String.valueOf(o);
    }

    private void mergeCsv(Source src, String rel, Map<String, Map<String, Object>> into, String key) {
        Path p = src.root.resolve(rel);
        if (!Files.isRegularFile(p)) return;
        try {
            for (Map<String, String> r : Csv.records(read(p), key)) {
                String id = r.get(key).trim();
                Map<String, Object> e = new LinkedHashMap<String, Object>(r);
                e.put("_source", src.id);
                e.put("_file", p.toString());
                Map<String, Object> prev = into.get(id);
                if (prev != null) {
                    List<Object> over = new ArrayList<Object>();
                    Object po = prev.get("_overrides");
                    if (po instanceof List) over.addAll((List<?>) po);
                    over.add(prev.get("_source"));
                    e.put("_overrides", over);
                }
                into.put(id, e);
            }
        } catch (Exception ex) {
            warnings.add(src.id + ": could not read " + rel + ": " + ex.getMessage());
        }
    }

    private void indexProj(Source src) {
        Path dir = src.root.resolve("data/weapons/proj");
        if (!Files.isDirectory(dir)) return;
        try (Stream<Path> st = Files.walk(dir, 3)) {
            st.filter(p -> p.getFileName().toString().toLowerCase().endsWith(".proj")).forEach(p -> {
                try {
                    Map<String, Object> j = Json.obj(Json.parse(read(p)));
                    if (j == null || j.get("id") == null) return;
                    Map<String, Object> e = new LinkedHashMap<String, Object>();
                    e.put("path", p.toString());
                    e.put("source", src.id);
                    projFiles.put(str(j.get("id")), e);
                } catch (Exception ignored) {}
            });
        } catch (IOException ignored) {}
    }

    public Source sourceOf(Path p) {
        Source best = null;
        Path n = p.toAbsolutePath().normalize();
        for (Source s : sources) if (n.startsWith(s.root.toAbsolutePath().normalize())) best = s;
        return best;
    }

    /** After a CSV row is saved, make the in-memory data match (keeps editor-only "_" fields like .wpn info). */
    public void updateRow(String kind, Map<String, Object> row, Path file) {
        Map<String, Map<String, Object>> m = "weapons".equals(kind) ? weapons : "wings".equals(kind) ? wings
                : "ships".equals(kind) ? ships : "hullmods".equals(kind) ? hullmods : "systems".equals(kind) ? systems : null;
        Source src = sourceOf(file);
        if ("descriptions".equals(kind)) {
            descriptions.put(row.get("type") + ":" + row.get("id"), new LinkedHashMap<String, Object>(row));
            return;
        }
        if (m == null || row.get("id") == null) return;
        String id = String.valueOf(row.get("id"));
        Map<String, Object> prev = m.get(id);
        Map<String, Object> e = new LinkedHashMap<String, Object>();
        for (Map.Entry<String, Object> en : row.entrySet()) if (!en.getKey().startsWith("_")) e.put(en.getKey(), en.getValue());
        if (prev != null) for (Map.Entry<String, Object> en : prev.entrySet()) if (en.getKey().startsWith("_")) e.put(en.getKey(), en.getValue());
        e.put("_source", src == null ? "?" : src.id);
        e.put("_file", file.toString());
        m.put(id, e);
    }

    private void mergeConfig(Source src, String rel, Map<String, Object> into) {
        Path p = src.root.resolve(rel);
        if (!Files.isRegularFile(p)) return;
        try {
            Map<String, Object> m = Json.obj(Json.parse(read(p)));
            if (m != null) into.putAll(m);
        } catch (Exception ex) {
            warnings.add(src.id + ": could not read " + rel + ": " + ex.getMessage());
        }
    }

    /** Re-reads one saved file so the indexes reflect it without a full reload. */
    public void reindex(Path p) {
        Source src = null;
        for (Source s : sources) if (p.toAbsolutePath().normalize().startsWith(s.root.toAbsolutePath().normalize())) src = s;
        if (src == null) return;
        String n = p.getFileName().toString().toLowerCase();
        try {
            Map<String, Object> j = Json.obj(Json.parse(read(p)));
            if (j == null) return;
            if (n.endsWith(".variant") && j.get("variantId") != null) {
                Map<String, Object> e = new LinkedHashMap<String, Object>();
                e.put("variantId", str(j.get("variantId")));
                e.put("hullId", str(j.get("hullId")));
                e.put("displayName", str(j.get("displayName")));
                e.put("path", p.toString());
                e.put("source", src.id);
                variants.put(str(j.get("variantId")), e);
                variantRefs.put(str(j.get("variantId")), variantRefsOf(j));
            } else if (n.endsWith(".wpn") && j.get("id") != null) {
                Map<String, Object> row = weapons.get(str(j.get("id")));
                if (row != null) {
                    row.put("_wpn", p.toString());
                    row.put("_size", str(j.get("size")));
                    row.put("_mountType", str(j.get("type")));
                    row.put("_turretSprite", str(j.get("turretSprite")));
                    row.put("_hardpointSprite", str(j.get("hardpointSprite")));
                }
            } else if (n.endsWith(".proj") && j.get("id") != null) {
                Map<String, Object> e = new LinkedHashMap<String, Object>();
                e.put("path", p.toString()); e.put("source", src.id);
                projFiles.put(str(j.get("id")), e);
            } else if ((n.endsWith(".ship") || n.endsWith(".skin"))) {
                boolean skin = n.endsWith(".skin");
                String id = str(j.get(skin ? "skinHullId" : "hullId"));
                if (id == null) return;
                Map<String, Object> e = new LinkedHashMap<String, Object>();
                e.put("hullId", id);
                e.put("kind", skin ? "skin" : "ship");
                e.put("path", p.toString());
                e.put("source", src.id);
                e.put("hullName", str(j.get("hullName")));
                e.put("hullSize", str(j.get("hullSize")));
                e.put("spriteName", str(j.get("spriteName")));
                if (skin) e.put("baseHullId", str(j.get("baseHullId")));
                hullFiles.put(id, e);
                hullRefs.put(id, hullRefsOf(j));
            } else if (n.endsWith(".faction")) {
                String rel = src.root.relativize(p).toString().replace('\\', '/');
                List<Map<String, Object>> parts = factionParts.computeIfAbsent(rel, k -> new ArrayList<Map<String, Object>>());
                final String sid = src.id;
                parts.removeIf(x -> sid.equals(x.get("source")));
                Map<String, Object> part = new LinkedHashMap<String, Object>();
                part.put("source", src.id); part.put("path", p.toString()); part.put("json", j);
                int at = 0; // keep load order: insert after parts from earlier sources
                for (int k = 0; k < parts.size(); k++) if (sourceIndex(str(parts.get(k).get("source"))) < sourceIndex(src.id)) at = k + 1;
                parts.add(at, part);
            } else if (n.equals("default_ship_roles.json")) {
                for (Map.Entry<String, Object> e : j.entrySet()) {
                    Map<String, Object> m = Json.obj(e.getValue());
                    if (m != null) roles.computeIfAbsent(e.getKey(), k -> new LinkedHashMap<String, Object>()).putAll(m);
                }
            } else if (n.endsWith(".system") && j.get("id") != null) {
                Map<String, Object> e = new LinkedHashMap<String, Object>();
                e.put("path", p.toString()); e.put("source", src.id);
                systemFiles.put(str(j.get("id")), e);
            }
        } catch (Exception ignored) {}
    }

    private void mergeDescriptions(Source src) {
        Path p = src.root.resolve("data/strings/descriptions.csv");
        if (!Files.isRegularFile(p)) return;
        try {
            for (Map<String, String> r : Csv.records(read(p), "id")) {
                String type = r.getOrDefault("type", "");
                descriptions.put(type + ":" + r.get("id").trim(), new LinkedHashMap<String, Object>(r));
            }
        } catch (Exception ex) {
            warnings.add(src.id + ": could not read descriptions.csv: " + ex.getMessage());
        }
    }

    private void indexHulls(Source src) {
        Path hulls = src.root.resolve("data/hulls");
        if (!Files.isDirectory(hulls)) return;
        try (Stream<Path> st = Files.walk(hulls, 3)) {
            st.filter(Files::isRegularFile).forEach(p -> {
                String n = p.getFileName().toString().toLowerCase();
                boolean skin = n.endsWith(".skin");
                if (!skin && !n.endsWith(".ship")) return;
                try {
                    Map<String, Object> j = Json.obj(Json.parse(read(p)));
                    if (j == null) return;
                    String id = str(j.get(skin ? "skinHullId" : "hullId"));
                    if (id == null) return;
                    Map<String, Object> e = new LinkedHashMap<String, Object>();
                    e.put("hullId", id);
                    e.put("kind", skin ? "skin" : "ship");
                    e.put("path", p.toString());
                    e.put("source", src.id);
                    e.put("hullName", str(j.get("hullName")));
                    e.put("hullSize", str(j.get("hullSize")));
                    e.put("spriteName", str(j.get("spriteName")));
                    if (skin) e.put("baseHullId", str(j.get("baseHullId")));
                    hullFiles.put(id, e);
                    hullRefs.put(id, hullRefsOf(j));
                } catch (Exception ex) {
                    warnings.add(src.id + ": unreadable " + hulls.relativize(p) + ": " + ex.getMessage());
                }
            });
        } catch (IOException ex) {
            warnings.add(src.id + ": could not scan hulls: " + ex.getMessage());
        }
    }

    private void indexVariants(Source src) {
        Path dir = src.root.resolve("data/variants");
        if (!Files.isDirectory(dir)) return;
        try (Stream<Path> st = Files.walk(dir, 6)) {
            st.filter(p -> p.getFileName().toString().toLowerCase().endsWith(".variant")).forEach(p -> {
                try {
                    Map<String, Object> j = Json.obj(Json.parse(read(p)));
                    if (j == null || j.get("variantId") == null) return;
                    Map<String, Object> e = new LinkedHashMap<String, Object>();
                    e.put("variantId", str(j.get("variantId")));
                    e.put("hullId", str(j.get("hullId")));
                    e.put("displayName", str(j.get("displayName")));
                    e.put("path", p.toString());
                    e.put("source", src.id);
                    variants.put(str(j.get("variantId")), e);
                    variantRefs.put(str(j.get("variantId")), variantRefsOf(j));
                } catch (Exception ignored) {
                    // Broken variant files are common in mods and the game skips them too.
                }
            });
        } catch (IOException ex) {
            warnings.add(src.id + ": could not scan variants: " + ex.getMessage());
        }
    }

    private void indexWeaponFiles(Source src) {
        Path dir = src.root.resolve("data/weapons");
        if (!Files.isDirectory(dir)) return;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.wpn")) {
            for (Path p : ds) {
                try {
                    Map<String, Object> j = Json.obj(Json.parse(read(p)));
                    if (j == null || j.get("id") == null) continue;
                    Map<String, Object> row = weapons.get(str(j.get("id")));
                    if (row == null) {
                        row = new LinkedHashMap<String, Object>();
                        row.put("id", str(j.get("id")));
                        row.put("_wpnOnly", Boolean.TRUE);
                        weapons.put(str(j.get("id")), row);
                    }
                    row.put("_wpn", p.toString());
                    row.put("_size", str(j.get("size")));
                    row.put("_mountType", str(j.get("type")));
                    row.put("_turretSprite", str(j.get("turretSprite")));
                    row.put("_hardpointSprite", str(j.get("hardpointSprite")));
                } catch (Exception ignored) {}
            }
        } catch (IOException ignored) {}
    }

    /** Adds per-size description values exported by the Starforge Data Export mod, if present. */
    private void attachHullmodExport() {
        Path p = commonDir.resolve("forge_bridge/hullmods.json.data");
        if (!Files.isRegularFile(p)) {
            return; // optional: values exported by the Starforge Data Export mod, if it was ever run
        }
        try {
            Map<String, Object> root = Json.obj(Json.parse(read(p)));
            Map<String, Object> all = Json.obj(root.get("hullmods"));
            for (Map.Entry<String, Object> e : all.entrySet()) {
                Map<String, Object> hm = hullmods.get(e.getKey());
                Map<String, Object> ex = Json.obj(e.getValue());
                if (hm != null && ex != null) hm.put("_params", ex.get("params"));
            }
        } catch (Exception e) {
            warnings.add("Could not read hullmod export: " + e.getMessage());
        }
    }

    // ------------------------------------------------------------ references, factions, sounds, systems

    int sourceIndex(String id) { for (int i = 0; i < sources.size(); i++) if (sources.get(i).id.equals(id)) return i; return -1; }

    static void addAll(List<String> out, Object arr) {
        List<Object> l = Json.arr(arr);
        if (l != null) for (Object o : l) if (o != null) out.add(String.valueOf(o));
    }

    static Map<String, List<String>> variantRefsOf(Map<String, Object> j) {
        Map<String, List<String>> r = new HashMap<String, List<String>>();
        List<String> w = new ArrayList<String>(), m = new ArrayList<String>(), wi = new ArrayList<String>(), mo = new ArrayList<String>();
        List<Object> groups = Json.arr(j.get("weaponGroups"));
        if (groups != null) for (Object g : groups) {
            Map<String, Object> gm = Json.obj(g); Map<String, Object> ws = gm == null ? null : Json.obj(gm.get("weapons"));
            if (ws != null) for (Object v : ws.values()) if (v != null) w.add(String.valueOf(v));
        }
        addAll(m, j.get("hullMods")); addAll(m, j.get("sMods")); addAll(m, j.get("permaMods"));
        addAll(wi, j.get("wings"));
        List<Object> mods = Json.arr(j.get("modules"));
        if (mods != null) for (Object o : mods) { Map<String, Object> om = Json.obj(o); if (om != null) for (Object v : om.values()) mo.add(String.valueOf(v)); }
        r.put("weapons", w); r.put("mods", m); r.put("wings", wi); r.put("modules", mo);
        return r;
    }

    static Map<String, List<String>> hullRefsOf(Map<String, Object> j) {
        Map<String, List<String>> r = new HashMap<String, List<String>>();
        List<String> m = new ArrayList<String>(), w = new ArrayList<String>(), wi = new ArrayList<String>();
        addAll(m, j.get("builtInMods"));
        Map<String, Object> bw = Json.obj(j.get("builtInWeapons"));
        if (bw != null) for (Object v : bw.values()) if (v != null) w.add(String.valueOf(v));
        addAll(wi, j.get("builtInWings"));
        r.put("mods", m); r.put("weapons", w); r.put("wings", wi);
        return r;
    }

    private void indexFactions(Source src) {
        Path dir = src.root.resolve("data/world/factions");
        if (!Files.isDirectory(dir)) return;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir)) {
            for (Path p : ds) {
                String n = p.getFileName().toString();
                try {
                    if (n.toLowerCase(Locale.ROOT).endsWith(".faction")) {
                        Map<String, Object> j = Json.obj(Json.parse(read(p)));
                        if (j == null) continue;
                        Map<String, Object> part = new LinkedHashMap<String, Object>();
                        part.put("source", src.id); part.put("path", p.toString()); part.put("json", j);
                        factionParts.computeIfAbsent("data/world/factions/" + n, k -> new ArrayList<Map<String, Object>>()).add(part);
                    } else if (n.equals("default_ship_roles.json")) {
                        Map<String, Object> j = Json.obj(Json.parse(read(p)));
                        if (j != null) for (Map.Entry<String, Object> e : j.entrySet()) {
                            Map<String, Object> m = Json.obj(e.getValue());
                            if (m != null) roles.computeIfAbsent(e.getKey(), k -> new LinkedHashMap<String, Object>()).putAll(m);
                        }
                    }
                } catch (Exception ex) {
                    warnings.add(src.id + ": unreadable " + n + ": " + ex.getMessage());
                }
            }
        } catch (IOException ignored) {}
    }

    private void indexSounds(Source src) {
        Path p = src.root.resolve("data/config/sounds.json");
        if (!Files.isRegularFile(p)) return;
        try { collectSounds(Json.obj(Json.parse(read(p))), src); }
        catch (Exception ex) { warnings.add(src.id + ": could not read sounds.json: " + ex.getMessage()); }
    }
    /** Sound ids map to arrays of {"file":..., "volume", "pitch"}; they may sit inside group objects. */
    private void collectSounds(Map<String, Object> m, Source src) {
        if (m == null) return;
        for (Map.Entry<String, Object> e : m.entrySet()) {
            Object v = e.getValue();
            if (v instanceof Map) { collectSounds(Json.obj(v), src); continue; }
            List<Object> l = Json.arr(v);
            if (l == null) continue;
            List<Object> files = new ArrayList<Object>();
            for (Object o : l) {
                Map<String, Object> f = Json.obj(o);
                if (f == null || f.get("file") == null || f.get("source") != null) continue; // archived music etc. can't be played
                Map<String, Object> x = new LinkedHashMap<String, Object>(f);
                x.put("mod", src.id);
                files.add(x);
            }
            if (!files.isEmpty()) sounds.put(e.getKey(), files);
        }
    }

    private void indexSystemFiles(Source src) {
        Path dir = src.root.resolve("data/shipsystems");
        if (!Files.isDirectory(dir)) return;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.system")) {
            for (Path p : ds) {
                try {
                    Map<String, Object> j = Json.obj(Json.parse(read(p)));
                    if (j == null || j.get("id") == null) continue;
                    Map<String, Object> e = new LinkedHashMap<String, Object>();
                    e.put("path", p.toString()); e.put("source", src.id);
                    systemFiles.put(str(j.get("id")), e);
                } catch (Exception ignored) {}
            }
        } catch (IOException ignored) {}
    }

    /** Merged view of each faction (arrays from later sources are appended, as the game does). */
    public List<Object> factionsSummary() {
        List<Object> out = new ArrayList<Object>();
        for (Map.Entry<String, List<Map<String, Object>>> e : factionParts.entrySet()) {
            Map<String, Object> f = new LinkedHashMap<String, Object>();
            f.put("rel", e.getKey());
            String[][] lists = { {"knownShips", "hulls"}, {"priorityShips", "hulls"}, {"knownWeapons", "weapons"}, {"priorityWeapons", "weapons"},
                    {"knownFighters", "fighters"}, {"priorityFighters", "fighters"}, {"knownHullMods", "hullMods"} };
            List<Object> parts = new ArrayList<Object>();
            for (Map<String, Object> part : e.getValue()) {
                Map<String, Object> j = Json.obj(part.get("json"));
                if (j.get("id") != null && f.get("id") == null) f.put("id", j.get("id"));
                if (j.get("displayName") != null) f.put("name", j.get("displayName"));
                if (j.get("color") != null) f.put("color", j.get("color"));
                for (String[] k : lists) {
                    Map<String, Object> blk = Json.obj(j.get(k[0]));
                    if (blk == null) continue;
                    @SuppressWarnings("unchecked") Map<String, Object> acc = (Map<String, Object>) f.computeIfAbsent(k[0], x -> new LinkedHashMap<String, Object>());
                    for (String sub : new String[] {"tags", k[1]}) {
                        @SuppressWarnings("unchecked") List<String> l = (List<String>) acc.computeIfAbsent(sub, x -> new ArrayList<String>());
                        addAll(l, blk.get(sub));
                    }
                }
                Map<String, Object> pm = new LinkedHashMap<String, Object>();
                pm.put("source", part.get("source")); pm.put("path", part.get("path"));
                parts.add(pm);
            }
            if (f.get("id") == null) f.put("id", e.getKey().replaceAll("^.*/|\\.faction$", ""));
            f.put("parts", parts);
            out.add(f);
        }
        return out;
    }

    /** Ships that mount a variant of this hull as a station module: [{parentVariant, parentHull, slot, moduleVariant}]. */
    public List<Object> moduleParents(String hullId) {
        List<Object> out = new ArrayList<Object>();
        for (Map.Entry<String, Map<String, List<String>>> e : variantRefs.entrySet()) {
            boolean uses = false;
            for (String mv : e.getValue().get("modules")) { Map<String, Object> v = variants.get(mv); if (v != null && hullId.equals(v.get("hullId"))) uses = true; }
            if (!uses) continue;
            Map<String, Object> pv = variants.get(e.getKey());
            if (pv == null) continue;
            try {
                Map<String, Object> j = Json.obj(Json.parse(read(Paths.get(str(pv.get("path"))))));
                List<Object> mods = Json.arr(j.get("modules"));
                List<Map<String, Object>> pairs = new ArrayList<Map<String, Object>>();
                if (mods != null) for (Object o : mods) { Map<String, Object> m = Json.obj(o); if (m != null) pairs.add(m); }
                else { Map<String, Object> m = Json.obj(j.get("modules")); if (m != null) pairs.add(m); }
                for (Map<String, Object> m : pairs) for (Map.Entry<String, Object> x : m.entrySet()) {
                    Map<String, Object> mv = variants.get(String.valueOf(x.getValue()));
                    if (mv == null || !hullId.equals(mv.get("hullId"))) continue;
                    Map<String, Object> r = new LinkedHashMap<String, Object>();
                    r.put("parentVariant", e.getKey()); r.put("parentHull", pv.get("hullId")); r.put("parentSource", pv.get("source"));
                    r.put("slot", x.getKey()); r.put("moduleVariant", String.valueOf(x.getValue()));
                    out.add(r);
                }
            } catch (Exception ignored) {}
        }
        return out;
    }

    /** Everything that refers to an id: kind is weapon, hullmod, wing, system or hull. */
    public List<Object> usage(String kind, String id) {
        List<Object> out = new ArrayList<Object>();
        String key = "weapon".equals(kind) ? "weapons" : "hullmod".equals(kind) ? "mods" : "wing".equals(kind) ? "wings" : null;
        if (key != null) {
            for (Map.Entry<String, Map<String, List<String>>> e : variantRefs.entrySet()) {
                int n = 0; for (String x : e.getValue().get(key)) if (x.equals(id)) n++;
                if (n == 0) continue;
                Map<String, Object> v = variants.get(e.getKey());
                if (v == null) continue;
                out.add(use("variant", e.getKey(), str(v.get("hullId")), str(v.get("source")), str(v.get("path")), n > 1 ? n + "×" : ""));
            }
            for (Map.Entry<String, Map<String, List<String>>> e : hullRefs.entrySet()) {
                int n = 0; for (String x : e.getValue().get(key)) if (x.equals(id)) n++;
                if (n == 0) continue;
                Map<String, Object> h = hullFiles.get(e.getKey());
                out.add(use("built-in", e.getKey(), e.getKey(), h == null ? null : str(h.get("source")), h == null ? null : str(h.get("path")), n > 1 ? n + "×" : ""));
            }
        }
        if ("weapon".equals(kind) || "wing".equals(kind)) {
            // fighters carry weapons through their wing's variant; wings are also referenced by id
            if ("weapon".equals(kind)) for (Map<String, Object> w : wings.values()) {
                Map<String, List<String>> r = variantRefs.get(str(w.get("variant")));
                if (r != null && r.get("weapons").contains(id)) out.add(use("wing", str(w.get("id")), str(w.get("variant")), str(w.get("_source")), str(w.get("_file")), "fighter loadout"));
            }
        }
        if ("system".equals(kind)) for (Map<String, Object> r : ships.values()) {
            if (id.equals(str(r.get("system id")))) out.add(use("hull", str(r.get("id")), str(r.get("name")), str(r.get("_source")), str(r.get("_file")), "ship system"));
            if (id.equals(str(r.get("defense id")))) out.add(use("hull", str(r.get("id")), str(r.get("name")), str(r.get("_source")), str(r.get("_file")), "defense (shield/phase)"));
        }
        if ("hull".equals(kind)) {
            for (Map<String, Object> v : variants.values()) if (id.equals(v.get("hullId"))) out.add(use("variant", str(v.get("variantId")), str(v.get("displayName")), str(v.get("source")), str(v.get("path")), ""));
            for (Map<String, Object> h : hullFiles.values()) if (id.equals(h.get("baseHullId"))) out.add(use("skin", str(h.get("hullId")), str(h.get("hullName")), str(h.get("source")), str(h.get("path")), ""));
            for (Map<String, Object> w : wings.values()) { Map<String, Object> v = variants.get(str(w.get("variant"))); if (v != null && id.equals(v.get("hullId"))) out.add(use("wing", str(w.get("id")), str(w.get("variant")), str(w.get("_source")), str(w.get("_file")), "fighter hull")); }
            for (Map.Entry<String, Map<String, List<String>>> e : variantRefs.entrySet()) for (String mv : e.getValue().get("modules")) {
                Map<String, Object> v = variants.get(mv);
                if (v != null && id.equals(v.get("hullId"))) { Map<String, Object> pv = variants.get(e.getKey()); out.add(use("module of", e.getKey(), pv == null ? "" : str(pv.get("hullId")), pv == null ? null : str(pv.get("source")), pv == null ? null : str(pv.get("path")), mv)); }
            }
        }
        // factions and roles
        String[][] fk = "hull".equals(kind) ? new String[][] {{"knownShips", "hulls"}, {"priorityShips", "hulls"}} : "weapon".equals(kind) ? new String[][] {{"knownWeapons", "weapons"}, {"priorityWeapons", "weapons"}}
                : "wing".equals(kind) ? new String[][] {{"knownFighters", "fighters"}, {"priorityFighters", "fighters"}} : "hullmod".equals(kind) ? new String[][] {{"knownHullMods", "hullMods"}} : new String[0][];
        for (Object fo : fk.length > 0 ? factionsSummary() : new ArrayList<Object>()) {
            Map<String, Object> f = Json.obj(fo);
            for (String[] k : fk) {
                Map<String, Object> blk = Json.obj(f.get(k[0]));
                List<Object> l = blk == null ? null : Json.arr(blk.get(k[1]));
                if (l != null && l.contains(id)) out.add(use("faction", str(f.get("id")), str(f.get("name")), null, null, k[0]));
            }
        }
        if ("hull".equals(kind)) for (Map.Entry<String, Map<String, Object>> r : roles.entrySet()) for (String vid : r.getValue().keySet()) {
            Map<String, Object> v = variants.get(vid);
            if (v != null && id.equals(v.get("hullId"))) out.add(use("role", r.getKey(), vid, null, null, "weight " + r.getValue().get(vid)));
        }
        return out;
    }
    private static Map<String, Object> use(String type, String id, String label, String source, String path, String detail) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("type", type); m.put("id", id); m.put("label", label); m.put("source", source); m.put("path", path); m.put("detail", detail);
        return m;
    }

    // ------------------------------------------------------------ lookups

    /** Finds a game-relative asset (e.g. graphics/ships/x.png), mods overriding core. */
    public Path resolveAsset(String rel) {
        rel = rel.replace('\\', '/');
        while (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.contains("..")) return null;
        for (int k = sources.size() - 1; k >= 0; k--) {
            Path p = sources.get(k).root.resolve(rel);
            if (Files.isRegularFile(p)) return p;
        }
        return null;
    }

    private volatile Map<String, Object> imageIndex;
    public void invalidateImages() { imageIndex = null; }

    /** Every image under graphics/ in every source: {sources:[id..], files:[[rel, sourceIndex], ..]}; mods override core by path. */
    public Map<String, Object> images() {
        Map<String, Object> idx = imageIndex;
        if (idx != null) return idx;
        final Map<String, Integer> winner = new TreeMap<String, Integer>(String.CASE_INSENSITIVE_ORDER);
        List<Object> ids = new ArrayList<Object>();
        for (int k = 0; k < sources.size(); k++) {
            final Source s = sources.get(k);
            ids.add(s.id);
            final Path g = s.root.resolve("graphics");
            if (!Files.isDirectory(g)) continue;
            final int si = k;
            try (java.util.stream.Stream<Path> st = Files.walk(g)) {
                st.filter(Files::isRegularFile).forEach(p -> {
                    String n = p.getFileName().toString().toLowerCase(Locale.ROOT);
                    if (!(n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg"))) return;
                    winner.put(s.root.relativize(p).toString().replace('\\', '/'), si);
                });
            } catch (Exception e) { /* unreadable folder: skip */ }
        }
        List<Object> files = new ArrayList<Object>(winner.size());
        for (Map.Entry<String, Integer> e : winner.entrySet()) files.add(Arrays.asList(e.getKey(), e.getValue()));
        idx = new LinkedHashMap<String, Object>();
        idx.put("sources", ids); idx.put("files", files);
        imageIndex = idx;
        return idx;
    }

    public boolean isInsideGame(Path p) {
        Path n = p.toAbsolutePath().normalize();
        return n.startsWith(gameDir.toAbsolutePath().normalize());
    }

    /** Writable means inside the mods folder (the game install itself stays read-only). */
    public boolean isWritable(Path p) {
        Path n = p.toAbsolutePath().normalize();
        return n.startsWith(modsDir.toAbsolutePath().normalize());
    }

    static String str(Object o) { return o == null ? null : String.valueOf(o); }
}
