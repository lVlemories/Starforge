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
import java.nio.file.*;
import java.util.*;

/**
 * Before the editor changes a file, a copy goes to backups/<batch>/files/... next to the editor.
 * One batch per "Save all" (the browser sends the batch id). manifest.json records each file's original path and
 * whether it existed (new files are listed so a restore can remove them). The newest KEEP batches are kept.
 */
final class Backups {
    static final int KEEP = 100;
    private Backups() {}

    static Path root() { return Paths.get("backups").toAbsolutePath(); }

    private static String clean(String batch) {
        String b = batch == null ? "" : batch.replaceAll("[^0-9A-Za-z_.-]", "");
        if (b.isEmpty()) b = new java.text.SimpleDateFormat("yyyy-MM-dd_HH-mm-ss").format(new Date());
        return b;
    }

    /** Call before writing p. Keeps only the first copy per batch, so it's the state before this Save all. */
    static synchronized void before(Path gameDir, Path p, String batch, String what) {
        try {
            p = p.toAbsolutePath().normalize();
            Path dir = root().resolve(clean(batch));
            Path manifestFile = dir.resolve("manifest.json");
            Map<String, Object> man = Files.exists(manifestFile) ? Json.obj(Json.parse(GameData.read(manifestFile))) : null;
            if (man == null) {
                man = new LinkedHashMap<String, Object>();
                man.put("time", new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
                man.put("files", new ArrayList<Object>());
            }
            List<Object> files = Json.arr(man.get("files"));
            for (Object o : files) if (p.toString().equals(Json.obj(o).get("path"))) return; // already saved in this batch
            String rel = gameDir != null && p.startsWith(gameDir) ? gameDir.relativize(p).toString() : p.toString().replace(":", "").replaceAll("^[/\\\\]+", "");
            Map<String, Object> e = new LinkedHashMap<String, Object>();
            e.put("path", p.toString());
            e.put("existed", Files.exists(p));
            if (what != null) e.put("what", what);
            if (Files.exists(p)) {
                Path copy = dir.resolve("files").resolve(rel).normalize();
                if (!copy.startsWith(dir)) return;
                Files.createDirectories(copy.getParent());
                Files.copy(p, copy, StandardCopyOption.REPLACE_EXISTING);
                e.put("copy", dir.relativize(copy).toString().replace('\\', '/'));
            }
            files.add(e);
            Files.createDirectories(dir);
            Files.write(manifestFile, Json.pretty(man).getBytes(StandardCharsets.UTF_8));
            prune();
        } catch (Exception ex) {
            System.err.println("Backup of " + p + " failed: " + ex.getMessage());
        }
    }

    static List<Path> batches() {
        List<Path> out = new ArrayList<Path>();
        if (!Files.isDirectory(root())) return out;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(root())) {
            for (Path d : ds) if (Files.isRegularFile(d.resolve("manifest.json"))) out.add(d);
        } catch (IOException ignored) {}
        out.sort((a, b) -> b.getFileName().toString().compareTo(a.getFileName().toString()));
        return out;
    }

    private static void prune() {
        List<Path> all = batches();
        for (int i = KEEP; i < all.size(); i++) deleteTree(all.get(i));
    }

    static void deleteTree(Path d) {
        try (java.util.stream.Stream<Path> st = Files.walk(d)) {
            List<Path> l = new ArrayList<Path>();
            st.forEach(l::add);
            Collections.reverse(l);
            for (Path p : l) Files.deleteIfExists(p);
        } catch (IOException ignored) {}
    }

    static List<Object> list() {
        List<Object> out = new ArrayList<Object>();
        for (Path d : batches()) {
            try {
                Map<String, Object> man = Json.obj(Json.parse(GameData.read(d.resolve("manifest.json"))));
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("id", d.getFileName().toString());
                m.put("time", man.get("time"));
                m.put("files", man.get("files"));
                m.put("restoredFrom", man.get("restoredFrom"));
                out.add(m);
            } catch (Exception ignored) {}
        }
        return out;
    }

    /**
     * Puts every file in the batch back as it was. Files the batch created are removed when removeCreated is set.
     * The current state is backed up first (as its own batch), so a restore can itself be undone.
     */
    static synchronized Map<String, Object> restore(GameData d, String id, boolean removeCreated) throws IOException {
        Path dir = root().resolve(clean(id));
        Map<String, Object> man = Json.obj(Json.parse(GameData.read(dir.resolve("manifest.json"))));
        String undo = new java.text.SimpleDateFormat("yyyy-MM-dd_HH-mm-ss").format(new Date()) + "_before-restore";
        int restored = 0, removed = 0;
        List<String> problems = new ArrayList<String>();
        for (Object o : Json.arr(man.get("files"))) {
            Map<String, Object> e = Json.obj(o);
            Path p = Paths.get(String.valueOf(e.get("path")));
            if (!d.isWritable(p)) { problems.add(p + ": outside the mods folder, skipped"); continue; }
            before(d.gameDir, p, undo, "before restoring " + id);
            if (Boolean.TRUE.equals(e.get("existed")) && e.get("copy") != null) {
                Files.createDirectories(p.getParent());
                Files.copy(dir.resolve(String.valueOf(e.get("copy"))), p, StandardCopyOption.REPLACE_EXISTING);
                restored++;
            } else if (removeCreated && Files.exists(p)) { Files.delete(p); removed++; }
        }
        Path um = root().resolve(undo).resolve("manifest.json");
        if (Files.exists(um)) {
            Map<String, Object> m = Json.obj(Json.parse(GameData.read(um)));
            m.put("restoredFrom", id);
            Files.write(um, Json.pretty(m).getBytes(StandardCharsets.UTF_8));
        }
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("restored", restored); r.put("removed", removed); r.put("problems", problems); r.put("undo", undo);
        return r;
    }
}
