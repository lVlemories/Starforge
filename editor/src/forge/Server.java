/*
 * Starforge: a Starsector ship, weapon and mod editor.
 * Copyright (C) 2026 Claude
 * SPDX-License-Identifier: GPL-3.0-or-later
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
 * version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
 */
package forge;

import java.awt.Desktop;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/** Local-only web server for Starforge UI. Binds to 127.0.0.1. */
public final class Server {
    private static volatile GameData data;
    /** Random per-run key. Only the browser tab the editor opens gets it (as an HttpOnly, SameSite cookie). */
    private static final String TOKEN = newToken();
    private static String newToken() {
        byte[] b = new byte[24];
        new java.security.SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
    /** Private per-user file holding the session link, so a second launch can open the running editor. */
    static Path sessionFile(int port) { return Paths.get(System.getProperty("user.home", "."), ".forge-editor", "session-" + port + ".txt"); }
    static void writeSessionFile(int port, String url) {
        try {
            Path f = sessionFile(port);
            Files.createDirectories(f.getParent());
            Files.write(f, url.getBytes(StandardCharsets.UTF_8));
            try { Files.setPosixFilePermissions(f, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")); } catch (Exception ignored) {} // Windows: the profile folder is private already
            f.toFile().deleteOnExit();
        } catch (IOException e) { System.err.println("Couldn't write the session file: " + e.getMessage()); }
    }
    static String sessionUrl(int port) {
        try { return new String(Files.readAllBytes(sessionFile(port)), StandardCharsets.UTF_8).trim(); } catch (Exception e) { return null; }
    }
    static boolean sameToken(String t) { return t != null && java.security.MessageDigest.isEqual(t.getBytes(StandardCharsets.UTF_8), TOKEN.getBytes(StandardCharsets.UTF_8)); }
    static String cookieToken(HttpExchange ex) {
        List<String> cs = ex.getRequestHeaders().get("Cookie");
        if (cs != null) for (String c : cs) for (String part : c.split(";")) { String x = part.trim(); if (x.startsWith("forge_session=")) return x.substring(14); }
        return null;
    }
    static final String LOCKED_PAGE = "<!DOCTYPE html><html><head><meta charset=utf-8><title>Starforge</title><style>body{font:15px system-ui,sans-serif;background:#0b1118;color:#cfd8e3;"
            + "display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{max-width:560px;line-height:1.6}code{color:#7fd4ff}</style></head><body><div>"
            + "<h2>This editor window isn't unlocked</h2><p>For safety the editor only answers the browser tab it opened itself. Start it with "
            + "<code>Start Starforge.bat</code> (it reopens the running editor if it's already open), or copy the full link shown in its console window.</p></div></body></html>";
    private static volatile Path gameDir; // null until a Starsector folder is found or chosen

    public static void main(String[] args) throws Exception {
        gameDir = findGameDir(args.length > 0 ? args[0] : null);
        if (gameDir == null) {
            System.out.println("Couldn't find your Starsector folder automatically.");
            System.out.println("Choose it in the browser window that opens; it will be remembered in starsector-path.txt.");
        } else System.out.println("Starsector folder: " + gameDir);
        int first = args.length > 1 ? Integer.parseInt(args[1]) : 8765;
        HttpServer http = null;
        int port = first;
        for (; port < first + 20; port++) {
            if (isForgeRunning(port)) {
                // Already open in another window: just bring it up in the browser.
                String url = sessionUrl(port);
                if (url == null) url = "http://127.0.0.1:" + port + "/";
                System.out.println("Starforge is already running - opening it.");
                openBrowser(url);
                return;
            }
            try {
                http = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
                break;
            } catch (java.net.BindException busy) {
                System.out.println("Port " + port + " is in use by another program, trying " + (port + 1) + "...");
            }
        }
        if (http == null) {
            System.err.println("No free port between " + first + " and " + (first + 19) + ".");
            System.exit(1);
        }
        http.setExecutor(Executors.newFixedThreadPool(8));
        http.createContext("/", Server::handle);
        http.start();
        if (gameDir != null) new Thread(Server::reload, "forge-loader").start();
        String url = "http://127.0.0.1:" + port + "/?t=" + TOKEN;
        writeSessionFile(port, url);
        System.out.println("Starforge running at " + url);
        System.out.println("(this link is private to this session; close this window to stop the editor)");
        openBrowser(url);
    }

    // ------------------------------------------------------------ finding the Starsector folder

    static boolean isGame(Path p) { try { return p != null && Files.isDirectory(p) && GameData.layout(p)[0] != null; } catch (Exception e) { return false; } }

    /** The folder itself or one of its parents (so picking starsector-core or Starsector.app also works). */
    static Path gameRootOf(Path p) {
        p = p.toAbsolutePath().normalize();
        for (int i = 0; i < 4 && p != null; i++, p = p.getParent()) {
            if (isGame(p)) {
                // prefer the Windows root over its starsector-core, and the .app over its inner folders
                Path parent = p.getParent();
                if (parent != null && p.getFileName() != null && p.getFileName().toString().equalsIgnoreCase("starsector-core") && isGame(parent)) return parent;
                return p;
            }
        }
        return null;
    }

    /** Command-line folder, then starsector-path.txt, then the folders around the editor, then common install places. */
    static Path findGameDir(String arg) {
        List<Path> tries = new ArrayList<Path>();
        if (arg != null && !arg.trim().isEmpty()) tries.add(Paths.get(arg.trim()));
        Path remembered = rememberedGameDir();
        if (remembered != null) tries.add(remembered);
        Path here = Paths.get("").toAbsolutePath();
        tries.add(here.getParent() == null ? here : here.getParent());
        tries.add(here);
        for (Path t : tries) { Path g = t == null ? null : gameRootOf(t); if (g != null) return g; }
        List<Path> found = detectInstalls();
        return found.isEmpty() ? null : found.get(0);
    }

    static Path rememberedGameDir() {
        try {
            Path f = Paths.get("starsector-path.txt");
            if (!Files.isRegularFile(f)) return null;
            for (String line : new String(Files.readAllBytes(f), StandardCharsets.UTF_8).split("\\r?\\n")) {
                String l = line.replace("\uFEFF", "").trim().replaceAll("^\"|\"$", "");
                if (!l.isEmpty() && !l.startsWith("#")) return Paths.get(l);
            }
        } catch (Exception ignored) {}
        return null;
    }

    static void rememberGameDir(Path g) {
        try { Files.write(Paths.get("starsector-path.txt"), (g.toString() + System.lineSeparator()).getBytes(StandardCharsets.UTF_8)); }
        catch (IOException e) { System.err.println("Couldn't write starsector-path.txt: " + e.getMessage()); }
    }

    /** Looks in the usual install places (and the Windows uninstall registry). Returns real installs, best first. */
    static List<Path> detectInstalls() {
        final List<Path> cands = new ArrayList<Path>();
        String os = System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT);
        Path home = Paths.get(System.getProperty("user.home", "."));
        if (os.contains("win")) {
            cands.addAll(registryInstalls());
            for (String env : new String[] {"ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"}) {
                String v = System.getenv(env);
                if (v != null) cands.add(Paths.get(v, "Fractal Softworks", "Starsector"));
            }
            for (java.io.File root : java.io.File.listRoots()) {
                Path r = root.toPath();
                for (String sub : new String[] {"Starsector", "Games\\Starsector", "Fractal Softworks\\Starsector", "Games\\Fractal Softworks\\Starsector",
                        "Program Files (x86)\\Fractal Softworks\\Starsector", "Program Files\\Fractal Softworks\\Starsector"}) cands.add(r.resolve(sub));
            }
            for (String sub : new String[] {"Starsector", "Games\\Starsector", "Desktop\\Starsector", "Downloads\\Starsector", "Documents\\Starsector"}) cands.add(home.resolve(sub));
        } else if (os.contains("mac")) {
            cands.add(Paths.get("/Applications/Starsector.app"));
            cands.add(home.resolve("Applications/Starsector.app"));
            cands.add(home.resolve("Games/Starsector.app"));
        } else {
            for (String sub : new String[] {"starsector", "Starsector", "Games/starsector", "Games/Starsector", ".local/share/starsector", "Applications/starsector"}) cands.add(home.resolve(sub));
            cands.add(Paths.get("/opt/starsector"));
        }
        // one level of guessing: top-level folders (and Games folders) whose name mentions starsector
        List<Path> roots = new ArrayList<Path>();
        if (os.contains("win")) for (java.io.File root : java.io.File.listRoots()) { roots.add(root.toPath()); roots.add(root.toPath().resolve("Games")); }
        roots.add(home); roots.add(home.resolve("Games"));
        for (Path r : roots) {
            if (!Files.isDirectory(r)) continue;
            try (java.nio.file.DirectoryStream<Path> ds = Files.newDirectoryStream(r)) {
                for (Path p : ds) if (p.getFileName().toString().toLowerCase(java.util.Locale.ROOT).contains("starsector")) cands.add(p);
            } catch (Exception ignored) {}
        }
        List<Path> out = new ArrayList<Path>();
        java.util.Set<String> seen = new java.util.HashSet<String>();
        for (Path c : cands) {
            Path g = null;
            try { if (Files.isDirectory(c)) g = gameRootOf(c); } catch (Exception ignored) {}
            if (g == null) continue;
            String key;
            try { key = g.toRealPath().toString().toLowerCase(java.util.Locale.ROOT); } catch (Exception e) { key = g.toString().toLowerCase(java.util.Locale.ROOT); }
            if (seen.add(key)) out.add(g);
        }
        return out;
    }

    /** Folders named in Starsector's uninstall entries (the Windows installer records where it put the game). */
    static List<Path> registryInstalls() {
        List<Path> out = new ArrayList<Path>();
        String[] keys = { "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" };
        for (String k : keys) {
            try {
                Process pr = new ProcessBuilder("reg", "query", k, "/s", "/f", "Starsector").redirectErrorStream(true).start();
                if (!pr.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) { pr.destroyForcibly(); continue; }
                String txt = new String(readAll(pr.getInputStream()), StandardCharsets.UTF_8);
                for (String line : txt.split("\\r?\\n")) {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("(?i)(InstallLocation|UninstallString|DisplayIcon)\\s+REG_\\w+\\s+\"?([A-Za-z]:\\\\[^\"]+?)\"?\\s*(,\\d+)?$").matcher(line.trim());
                    if (!m.find()) continue;
                    Path p = Paths.get(m.group(2).trim());
                    out.add(p.getFileName() != null && p.getFileName().toString().toLowerCase(java.util.Locale.ROOT).endsWith(".exe") ? p.getParent() : p);
                }
            } catch (Exception ignored) {}
        }
        return out;
    }

    /** Folder listing for the in-browser folder picker; marks Starsector folders. */
    static Map<String, Object> browse(String path) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        List<Object> roots = new ArrayList<Object>();
        for (java.io.File r : java.io.File.listRoots()) roots.add(r.toString());
        m.put("roots", roots);
        m.put("home", System.getProperty("user.home"));
        Path p = path == null || path.trim().isEmpty() ? Paths.get(System.getProperty("user.home", ".")) : Paths.get(path.trim());
        p = p.toAbsolutePath().normalize();
        m.put("path", p.toString());
        m.put("parent", p.getParent() == null ? null : p.getParent().toString());
        m.put("isStarsector", gameRootOf(p) != null && gameRootOf(p).equals(p));
        List<Object> dirs = new ArrayList<Object>();
        try (java.nio.file.DirectoryStream<Path> ds = Files.newDirectoryStream(p)) {
            List<Path> list = new ArrayList<Path>();
            for (Path c : ds) if (Files.isDirectory(c) && !c.getFileName().toString().startsWith("$")) list.add(c);
            list.sort((a, b) -> a.getFileName().toString().compareToIgnoreCase(b.getFileName().toString()));
            for (Path c : list) {
                Map<String, Object> e = new LinkedHashMap<String, Object>();
                e.put("name", c.getFileName().toString());
                e.put("starsector", isGame(c));
                dirs.add(e);
            }
        } catch (Exception e) { m.put("error", "Can't open this folder: " + e.getMessage()); }
        m.put("dirs", dirs);
        return m;
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported()) Desktop.getDesktop().browse(new URI(url));
        } catch (Throwable ignored) {}
    }

    /** True if Starforge already answers on this port. */
    private static boolean isForgeRunning(int port) {
        try {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL("http://127.0.0.1:" + port + "/api/whoami").openConnection();
            c.setConnectTimeout(300);
            c.setReadTimeout(500);
            if (c.getResponseCode() != 200) return false;
            return new String(readAll(c.getInputStream()), StandardCharsets.UTF_8).contains("forge-editor");
        } catch (Exception e) {
            return false;
        }
    }

    private static Path settingsFile() { return Paths.get("starforge-settings.json").toAbsolutePath(); }
    /** Settings to read: the current file, or the one older versions (named "Forge") wrote. */
    private static Path settingsToRead() {
        Path p = settingsFile(), old = Paths.get("forge-settings.json").toAbsolutePath();
        return Files.exists(p) || !Files.exists(old) ? p : old;
    }

    static Map<String, Object> settings() {
        try {
            Map<String, Object> m = Json.obj(Json.parse(GameData.read(settingsToRead())));
            if (m != null) return m;
        } catch (Exception ignored) {}
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("modMode", "all");
        return m;
    }
    /** modMode, with the older allMods true/false setting still understood. */
    static String modMode(Map<String, Object> st) {
        Object m = st.get("modMode");
        if (m != null) return String.valueOf(m);
        return Boolean.FALSE.equals(st.get("allMods")) ? "enabled" : "all";
    }

    private static synchronized void reload() {
        if (data != null || gameDir == null) return;
        long t = System.currentTimeMillis();
        Map<String, Object> st = settings();
        List<String> folders = new ArrayList<String>();
        List<Object> sel = Json.arr(st.get("selectedFolders"));
        if (sel != null) for (Object o : sel) folders.add(String.valueOf(o));
        GameData d = new GameData(gameDir, modMode(st), folders);
        d.load();
        data = d;
        System.out.println("Loaded " + d.sources.size() + " sources, " + d.hullFiles.size() + " hulls, "
                + d.weapons.size() + " weapons, " + d.hullmods.size() + " hullmods, " + d.wings.size()
                + " wings in " + (System.currentTimeMillis() - t) + " ms");
    }

    /**
     * Only the editor's own page may use the API. Web pages from other sites open in the same browser could
     * otherwise POST to localhost and write files into the mods folder.
     *  - Host must be localhost/127.0.0.1 (blocks DNS rebinding).
     *  - Writes must be POST with a JSON body and the X-Forge header, which other sites can't send without
     *    a CORS preflight that this server never approves; any Origin header must be this server.
     */
    static String rejectForeign(HttpExchange ex) {
        String host = ex.getRequestHeaders().getFirst("Host");
        if (host != null) {
            String h = host.replaceAll(":\\d+$", "").toLowerCase(java.util.Locale.ROOT);
            if (!h.equals("127.0.0.1") && !h.equals("localhost") && !h.equals("[::1]")) return "Unexpected host";
        }
        String origin = ex.getRequestHeaders().getFirst("Origin");
        if (origin != null && !origin.equals("null")) {
            String o = origin.toLowerCase(java.util.Locale.ROOT);
            if (!(o.startsWith("http://127.0.0.1:") || o.startsWith("http://localhost:")) || host == null || !o.endsWith("://" + host.toLowerCase(java.util.Locale.ROOT)))
                return "Cross-origin request refused";
        } else if (origin != null) return "Cross-origin request refused";
        if (!"GET".equals(ex.getRequestMethod()) && !"HEAD".equals(ex.getRequestMethod())) {
            String ct = String.valueOf(ex.getRequestHeaders().getFirst("Content-Type"));
            if (!"1".equals(ex.getRequestHeaders().getFirst("X-Forge")) || !ct.startsWith("application/json")) return "Request refused";
        }
        return null;
    }

    private static void handle(HttpExchange ex) throws IOException {
        try {
            String path = ex.getRequestURI().getPath();
            securityHeaders(ex);
            String why = rejectForeign(ex);
            if (why != null) { send(ex, 403, "text/plain", why.getBytes(StandardCharsets.UTF_8)); return; }
            Map<String, String> q = query(ex.getRequestURI().getRawQuery());
            // session key: the link the editor opens carries it once; after that it's an HttpOnly, SameSite=Strict cookie
            if (!path.equals("/api/whoami")) {
                if (path.equals("/") && sameToken(q.get("t"))) {
                    ex.getResponseHeaders().add("Set-Cookie", "forge_session=" + TOKEN + "; HttpOnly; SameSite=Strict; Path=/");
                    ex.getResponseHeaders().set("Location", "/");
                    send(ex, 303, "text/plain", new byte[0]);
                    return;
                }
                if (!sameToken(cookieToken(ex))) {
                    if (path.equals("/")) send(ex, 401, "text/html; charset=utf-8", LOCKED_PAGE.getBytes(StandardCharsets.UTF_8));
                    else send(ex, 401, "text/plain", "Not unlocked: open the editor from its start script".getBytes(StandardCharsets.UTF_8));
                    return;
                }
            }
            GameData d = data;
            if (path.equals("/api/setup")) {
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("gameDir", gameDir == null ? null : gameDir.toString());
                List<Object> found = new ArrayList<Object>();
                for (Path f : detectInstalls()) found.add(f.toString());
                m.put("found", found);
                m.put("pathFile", Paths.get("starsector-path.txt").toAbsolutePath().toString());
                json(ex, m);
                return;
            }
            if (path.equals("/api/browse")) { json(ex, browse(q.get("path"))); return; }
            if (path.equals("/api/setgamedir") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path g = gameRootOf(Paths.get(String.valueOf(body.get("path"))));
                if (g == null) { send(ex, 400, "text/plain", ("That isn't a Starsector folder. Choose the folder that contains starsector-core (Windows), "
                        + "Starsector.app (macOS) or data and starsector.sh (Linux).").getBytes(StandardCharsets.UTF_8)); return; }
                rememberGameDir(g);
                gameDir = g; data = null;
                new Thread(Server::reload, "forge-loader").start();
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("gameDir", g.toString());
                json(ex, m);
                return;
            }
            if (gameDir == null && (path.startsWith("/asset/") || path.startsWith("/api/")) && !path.equals("/api/whoami")) {
                send(ex, 409, "text/plain", "Choose your Starsector folder first".getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (d == null && (path.startsWith("/asset/") || path.startsWith("/api/")) && !path.equals("/api/loading") && !path.equals("/api/whoami")) {
                send(ex, 503, "text/plain", "Loading game data...".getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (path.equals("/api/whoami")) {
                send(ex, 200, "text/plain", "forge-editor".getBytes(StandardCharsets.UTF_8));
            } else if (path.equals("/api/loading")) {
                json(ex, d == null ? Boolean.TRUE : Boolean.FALSE);
            } else if (path.equals("/") || path.startsWith("/web/")) {
                staticFile(ex, path.equals("/") ? "index.html" : path.substring(5));
            } else if (path.startsWith("/asset/")) {
                Path p = d.resolveAsset(URLDecoder.decode(path.substring(7), "UTF-8"));
                if (p == null) send(ex, 404, "text/plain", "Asset not found".getBytes(StandardCharsets.UTF_8));
                else send(ex, 200, mime(p.toString()), Files.readAllBytes(p));
            } else if (path.equals("/api/summary")) {
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                List<Object> src = new ArrayList<Object>();
                for (GameData.Source s : d.sources) src.add(s.toJson());
                m.put("gameDir", d.gameDir.toString());
                m.put("sources", src);
                m.put("warnings", d.warnings);
                m.put("counts", counts(d));
                json(ex, m);
            } else if (path.equals("/api/hulls")) {
                List<Object> out = new ArrayList<Object>();
                for (Map<String, Object> h : d.hullFiles.values()) {
                    Map<String, Object> e = new LinkedHashMap<String, Object>(h);
                    Map<String, Object> row = d.ships.get(String.valueOf(h.get("hullId")));
                    if (row != null) { e.put("designation", row.get("designation")); e.put("hints", row.get("hints")); }
                    if (e.get("hullSize") == null && h.get("baseHullId") != null) {
                        Map<String, Object> base = d.hullFiles.get(String.valueOf(h.get("baseHullId")));
                        if (base != null) e.put("hullSize", base.get("hullSize"));
                    }
                    out.add(e);
                }
                json(ex, out);
            } else if (path.equals("/api/hull")) {
                json(ex, hull(d, q.get("id")));
            } else if (path.equals("/api/variants")) {
                String hull = q.get("hull");
                List<Object> out = new ArrayList<Object>();
                for (Map<String, Object> v : d.variants.values())
                    if (hull == null || hull.equals(v.get("hullId"))) out.add(v);
                json(ex, out);
            } else if (path.equals("/api/file")) {
                Path p = Paths.get(q.get("path"));
                if (!d.isInsideGame(p)) { send(ex, 403, "text/plain", "Outside the Starsector folder".getBytes(StandardCharsets.UTF_8)); return; }
                json(ex, Json.parse(GameData.read(p)));
            } else if (path.equals("/api/hullmods")) {
                json(ex, new ArrayList<Object>(d.hullmods.values()));
            } else if (path.equals("/api/weapons")) {
                json(ex, new ArrayList<Object>(d.weapons.values()));
            } else if (path.equals("/api/wings")) {
                // add the fighter's sprite so the list can show icons
                List<Object> out = new ArrayList<Object>();
                for (Map<String, Object> w : d.wings.values()) {
                    Map<String, Object> r = new LinkedHashMap<String, Object>(w);
                    Map<String, Object> v = d.variants.get(String.valueOf(w.get("variant")));
                    Map<String, Object> h = v == null ? null : d.hullFiles.get(String.valueOf(v.get("hullId")));
                    String sprite = h == null ? null : (String) h.get("spriteName");
                    if ((sprite == null || sprite.isEmpty() || "null".equals(sprite)) && h != null && h.get("baseHullId") != null) {
                        Map<String, Object> b = d.hullFiles.get(String.valueOf(h.get("baseHullId")));
                        if (b != null) sprite = (String) b.get("spriteName");
                    }
                    if (sprite != null && !"null".equals(sprite)) r.put("_sprite", sprite);
                    if (h != null) r.put("_hullName", h.get("hullName"));
                    out.add(r);
                }
                json(ex, out);
            } else if (path.equals("/api/systems")) {
                json(ex, new ArrayList<Object>(d.systems.values()));
            } else if (path.equals("/api/styles")) {
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("engine", d.engineStyles);
                m.put("hull", d.hullStyles);
                json(ex, m);
            } else if (path.equals("/api/settings") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Map<String, Object> st = settings();
                st.putAll(body);
                Files.write(settingsFile(), Json.pretty(st).getBytes(StandardCharsets.UTF_8));
                json(ex, st);
            } else if (path.equals("/api/settings")) {
                Map<String, Object> st = settings();
                st.put("modMode", modMode(st));
                json(ex, st);
            } else if (path.equals("/api/modlist")) {
                List<Object> list = GameData.scanMods(d.modsDir);
                for (Object o : list) {
                    Map<String, Object> m = Json.obj(o);
                    boolean loaded = false;
                    for (GameData.Source s2 : d.sources) if (!s2.core && s2.root.getFileName().toString().equals(m.get("folder"))) loaded = true;
                    m.put("loaded", loaded);
                }
                json(ex, list);
            } else if (path.equals("/api/description")) {
                json(ex, d.descriptions.get(q.get("type") + ":" + q.get("id")));
            } else if (path.equals("/api/save") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path p = body.get("rel") != null
                        ? Paths.get(String.valueOf(body.get("root"))).resolve(String.valueOf(body.get("rel")).replace('\\', '/')).normalize()
                        : Paths.get(String.valueOf(body.get("path")));
                if (!d.isWritable(p)) { send(ex, 403, "text/plain", "Only files inside the mods folder can be saved; the game install stays read-only.".getBytes(StandardCharsets.UTF_8)); return; }
                Files.createDirectories(p.getParent());
                Map<String, Object> r = new LinkedHashMap<String, Object>();
                Backups.before(d.gameDir, p, body.get("batch") == null ? null : String.valueOf(body.get("batch")), null);
                if (body.get("base64") != null) { Files.write(p, java.util.Base64.getDecoder().decode(String.valueOf(body.get("base64")))); d.invalidateImages(); }
                else Files.write(p, String.valueOf(body.get("content")).getBytes(StandardCharsets.UTF_8));
                d.reindex(p);
                r.put("path", p.toString());
                json(ex, r);
            } else if (path.equals("/api/csvrow") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path p = body.get("rel") != null
                        ? Paths.get(String.valueOf(body.get("root"))).resolve(String.valueOf(body.get("rel")).replace('\\', '/')).normalize()
                        : Paths.get(String.valueOf(body.get("path")));
                if (!d.isWritable(p)) { send(ex, 403, "text/plain", "Only files inside the mods folder can be saved; the game install stays read-only.".getBytes(StandardCharsets.UTF_8)); return; }
                json(ex, saveCsvRow(d, p, body));
            } else if (path.equals("/api/preview") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path p = body.get("rel") != null
                        ? Paths.get(String.valueOf(body.get("root"))).resolve(String.valueOf(body.get("rel")).replace('\\', '/')).normalize()
                        : Paths.get(String.valueOf(body.get("path")));
                if (!d.isInsideGame(p)) { send(ex, 403, "text/plain", "Outside the Starsector folder".getBytes(StandardCharsets.UTF_8)); return; }
                Map<String, Object> r;
                if ("csv".equals(body.get("type"))) r = computeCsvRow(p, body);
                else if (body.get("base64") != null) {
                    r = new LinkedHashMap<String, Object>();
                    r.put("binary", Boolean.TRUE);
                    r.put("bytes", java.util.Base64.getDecoder().decode(String.valueOf(body.get("base64"))).length);
                    r.put("oldBytes", Files.exists(p) ? Files.size(p) : 0);
                    r.put("oldText", ""); r.put("newText", "");
                    r.put("path", p.toString());
                    r.put("action", Files.exists(p) ? "overwrite" : "create");
                } else {
                    r = new LinkedHashMap<String, Object>();
                    r.put("oldText", Files.exists(p) ? GameData.read(p) : "");
                    r.put("newText", String.valueOf(body.get("content")));
                    r.put("path", p.toString());
                    r.put("action", Files.exists(p) ? "overwrite" : "create");
                }
                r.put("exists", Files.exists(p));
                r.put("writable", d.isWritable(p));
                r.put("backup", Files.exists(p));
                json(ex, r);
            } else if (path.equals("/api/newmod") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                json(ex, createMod(d, body));
            } else if (path.equals("/api/proj")) {
                Map<String, Object> e = d.projFiles.get(q.get("id"));
                if (e == null) { json(ex, null); return; }
                Map<String, Object> r = new LinkedHashMap<String, Object>(e);
                r.put("json", Json.parse(GameData.read(Paths.get(String.valueOf(e.get("path"))))));
                json(ex, r);
            } else if (path.equals("/api/csvheader")) {
                Path p = Paths.get(q.get("path"));
                if (!d.isInsideGame(p)) { send(ex, 403, "text/plain", new byte[0]); return; }
                List<List<String>> rows = Csv.rows(GameData.read(p));
                json(ex, rows.isEmpty() ? new ArrayList<Object>() : rows.get(0));
            } else if (path.equals("/api/factions")) {
                json(ex, d.factionsSummary());
            } else if (path.equals("/api/roles")) {
                json(ex, d.roles);
            } else if (path.equals("/api/moduleparents")) {
                json(ex, d.moduleParents(q.get("hull")));
            } else if (path.equals("/api/usage")) {
                json(ex, d.usage(q.get("kind"), q.get("id")));
            } else if (path.equals("/api/sound")) {
                json(ex, d.sounds.get(q.get("id")));
            } else if (path.equals("/api/systemfile")) {
                Map<String, Object> e = d.systemFiles.get(q.get("id"));
                if (e == null) { json(ex, null); return; }
                Map<String, Object> r = new LinkedHashMap<String, Object>(e);
                r.put("json", Json.parse(GameData.read(Paths.get(String.valueOf(e.get("path"))))));
                json(ex, r);
            } else if (path.equals("/api/exportmod")) {
                GameData.Source src = null;
                for (GameData.Source s2 : d.sources) if (!s2.core && s2.id.equals(q.get("id"))) src = s2;
                if (src == null) { send(ex, 404, "text/plain", "No such mod".getBytes(StandardCharsets.UTF_8)); return; }
                exportZip(ex, src.root);
            } else if (path.equals("/api/images")) {
                json(ex, d.images());
            } else if (path.equals("/api/openfile") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path p = body.get("rel") != null ? d.resolveAsset(String.valueOf(body.get("rel"))) : Paths.get(String.valueOf(body.get("path")));
                if (p == null || !Files.exists(p)) { send(ex, 404, "text/plain", "File not found (not saved yet?)".getBytes(StandardCharsets.UTF_8)); return; }
                p = p.toAbsolutePath().normalize();
                if (!d.isInsideGame(p)) { send(ex, 403, "text/plain", "Outside the Starsector folder".getBytes(StandardCharsets.UTF_8)); return; }
                json(ex, openFile(p, Boolean.TRUE.equals(body.get("reveal")), String.valueOf(settings().getOrDefault("textEditor", ""))));
            } else if (path.equals("/api/backups")) {
                Map<String, Object> m = new LinkedHashMap<String, Object>();
                m.put("folder", Backups.root().toString());
                m.put("keep", Backups.KEEP);
                m.put("batches", Backups.list());
                json(ex, m);
            } else if (path.equals("/api/backups/open") && "POST".equals(ex.getRequestMethod())) {
                Files.createDirectories(Backups.root());
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Path target = Backups.root();
                if (body != null && body.get("id") != null) target = target.resolve(String.valueOf(body.get("id")).replaceAll("[^0-9A-Za-z_.-]", ""));
                json(ex, openFolder(target));
            } else if (path.equals("/api/backups/restore") && "POST".equals(ex.getRequestMethod())) {
                Map<String, Object> body = Json.obj(Json.parse(new String(readAll(ex.getRequestBody()), StandardCharsets.UTF_8)));
                Map<String, Object> r = Backups.restore(d, String.valueOf(body.get("id")), Boolean.TRUE.equals(body.get("removeCreated")));
                data = null;
                new Thread(Server::reload, "forge-loader").start();
                json(ex, r);
            } else if (path.equals("/api/reload") && "POST".equals(ex.getRequestMethod())) {
                data = null;
                new Thread(Server::reload, "forge-loader").start();
                json(ex, Boolean.TRUE);
            } else {
                send(ex, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable t) {
            t.printStackTrace();
            send(ex, 500, "text/plain", String.valueOf(t).getBytes(StandardCharsets.UTF_8));
        }
    }

    private static Map<String, Object> hull(GameData d, String id) throws IOException {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        Map<String, Object> file = d.hullFiles.get(id);
        if (file == null) return null;
        out.put("file", file);
        Map<String, Object> j = Json.obj(Json.parse(GameData.read(Paths.get(String.valueOf(file.get("path"))))));
        if ("skin".equals(file.get("kind"))) {
            // Skins layer over their base hull: resolve the base so the editor can draw slots and bounds.
            String base = String.valueOf(j.get("baseHullId"));
            Map<String, Object> bf = d.hullFiles.get(base);
            if (bf != null) {
                out.put("baseFile", bf);
                out.put("baseShip", Json.parse(GameData.read(Paths.get(String.valueOf(bf.get("path"))))));
                out.put("csv", d.ships.get(base));
            }
            out.put("skin", j);
        } else {
            out.put("ship", j);
            out.put("csv", d.ships.get(id));
        }
        return out;
    }

    /**
     * Writes one row into a mod's CSV: replaces the row with the same key (id, or id+type), or appends it.
     * Every other line is left byte-for-byte as it was. Creates the file (with the given columns) if needed.
     */
    private static Map<String, Object> saveCsvRow(GameData d, Path p, Map<String, Object> body) throws IOException {
        Map<String, Object> c = computeCsvRow(p, body);
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        Backups.before(d.gameDir, p, body.get("batch") == null ? null : String.valueOf(body.get("batch")), null);
        Files.createDirectories(p.getParent());
        Files.write(p, String.valueOf(c.get("newText")).getBytes(StandardCharsets.UTF_8));
        d.updateRow(String.valueOf(body.get("kind")), Json.obj(body.get("row")), p);
        r.put("action", c.get("action"));
        r.put("path", p.toString());
        return r;
    }

    /** Works out the CSV file text after the row change, without writing anything. */
    private static Map<String, Object> computeCsvRow(Path p, Map<String, Object> body) throws IOException {
        Map<String, Object> row = Json.obj(body.get("row"));
        List<Object> keysRaw = Json.arr(body.get("keys"));
        List<String> keys = new ArrayList<String>();
        if (keysRaw != null) for (Object k : keysRaw) keys.add(String.valueOf(k)); else keys.add("id");
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        String nl = "\r\n";
        String text;
        List<String> header;
        String oldText = "";
        if (Files.exists(p)) {
            text = GameData.read(p);
            oldText = text;
            if (text.contains("\r\n")) nl = "\r\n"; else if (text.contains("\n")) nl = "\n";
        } else {
            List<Object> cols = Json.arr(body.get("columns"));
            header = new ArrayList<String>();
            if (cols != null) for (Object c : cols) header.add(String.valueOf(c));
            else for (String k : row.keySet()) if (!k.startsWith("_")) header.add(k);
            text = Csv.line(header, Collections_identity(header)) + nl;
            r.put("created", Boolean.TRUE);
        }
        List<Csv.Rec> recs = Csv.recordsWithSpans(text);
        header = new ArrayList<String>();
        for (String h : recs.get(0).cells) header.add(h.trim());
        // Columns the row has but the file lacks are appended to the header line.
        List<String> missing = new ArrayList<String>();
        for (String k : row.keySet()) if (!k.startsWith("_") && !header.contains(k) && row.get(k) != null && !String.valueOf(row.get(k)).isEmpty()) missing.add(k);
        StringBuilder out = new StringBuilder(text);
        Csv.Rec match = null;
        for (int i = 1; i < recs.size(); i++) {
            Csv.Rec rec = recs.get(i);
            boolean ok = true;
            for (String k : keys) {
                int c = header.indexOf(k);
                String v = c >= 0 && c < rec.cells.size() ? rec.cells.get(c).trim() : "";
                if (!v.equals(String.valueOf(row.get(k)).trim())) { ok = false; break; }
            }
            if (ok) match = rec;
        }
        List<String> fullHeader = new ArrayList<String>(header);
        fullHeader.addAll(missing);
        String line = Csv.line(fullHeader, row);
        if (match != null) {
            boolean hadNl = match.end > match.start && (text.charAt(match.end - 1) == '\n' || text.charAt(match.end - 1) == '\r');
            out.replace(match.start, match.end, line + (hadNl ? nl : ""));
            r.put("action", "replaced");
        } else {
            if (out.length() > 0 && out.charAt(out.length() - 1) != '\n') out.append(nl);
            out.append(line).append(nl);
            r.put("action", "appended");
        }
        if (!missing.isEmpty()) {
            Csv.Rec h = recs.get(0);
            String hl = text.substring(h.start, h.end).replaceAll("[\\r\\n]+$", "");
            StringBuilder add = new StringBuilder(hl);
            for (String m : missing) add.append(',').append(Csv.quote(m));
            out.replace(h.start, h.start + hl.length(), add.toString());
        }
        r.put("oldText", oldText);
        r.put("newText", out.toString());
        r.put("path", p.toString());
        return r;
    }

    /** Creates mods/<folder>/mod_info.json (+ optional Version Checker files) and registers it as a source. */
    private static Map<String, Object> createMod(GameData d, Map<String, Object> b) throws IOException {
        String id = String.valueOf(b.get("id")).trim(), name = String.valueOf(b.get("name")).trim();
        if (!id.matches("[A-Za-z0-9_\\-.]+")) throw new IOException("Mod id may only use letters, digits, _ - and .");
        for (GameData.Source s : d.sources) if (s.id.equals(id)) throw new IOException("A mod with id '" + id + "' is already loaded.");
        String folder = name.replaceAll("[\\\\/:*?\"<>|]", "").trim();
        if (folder.isEmpty()) folder = id;
        Path root = d.modsDir.resolve(folder);
        if (Files.exists(root)) throw new IOException("Folder mods/" + folder + " already exists.");
        String version = String.valueOf(b.getOrDefault("version", "1.0.0"));
        Map<String, Object> info = new LinkedHashMap<String, Object>();
        info.put("id", id); info.put("name", name);
        info.put("author", String.valueOf(b.getOrDefault("author", "")));
        info.put("utility", "false");
        info.put("version", version);
        info.put("description", String.valueOf(b.getOrDefault("description", "")));
        info.put("gameVersion", String.valueOf(b.getOrDefault("gameVersion", "0.98.5a")));
        Files.createDirectories(root.resolve("data/hulls"));
        Files.write(root.resolve("mod_info.json"), Json.pretty(info).getBytes(StandardCharsets.UTF_8));
        List<Object> created = new ArrayList<Object>();
        created.add(root.resolve("mod_info.json").toString());
        if (Boolean.TRUE.equals(b.get("versionChecker"))) {
            String[] v = (version + ".0.0").split("\\.");
            Map<String, Object> vf = new LinkedHashMap<String, Object>();
            vf.put("masterVersionFile", String.valueOf(b.getOrDefault("masterVersionFile", "")));
            vf.put("modName", name);
            vf.put("modThreadId", "");
            Map<String, Object> mv = new LinkedHashMap<String, Object>();
            mv.put("major", v[0]); mv.put("minor", v[1]); mv.put("patch", v[2]);
            vf.put("modVersion", mv);
            Path vp = root.resolve(id + ".version");
            Files.write(vp, Json.pretty(vf).getBytes(StandardCharsets.UTF_8));
            Path csv = root.resolve("data/config/version/version_files.csv");
            Files.createDirectories(csv.getParent());
            Files.write(csv, ("version file\r\n" + id + ".version\r\n").getBytes(StandardCharsets.UTF_8));
            created.add(vp.toString()); created.add(csv.toString());
        }
        boolean enabled = false;
        if (Boolean.TRUE.equals(b.get("enable"))) {
            Path em = d.modsDir.resolve("enabled_mods.json");
            Map<String, Object> m = Files.exists(em) ? Json.obj(Json.parse(GameData.read(em))) : new LinkedHashMap<String, Object>();
            if (m == null) m = new LinkedHashMap<String, Object>();
            List<Object> list = Json.arr(m.get("enabledMods"));
            if (list == null) { list = new ArrayList<Object>(); m.put("enabledMods", list); }
            if (!list.contains(id)) list.add(id);
            Backups.before(d.gameDir, em, null, "enabling " + id);
            Files.write(em, Json.pretty(m).getBytes(StandardCharsets.UTF_8));
            enabled = true;
        }
        GameData.Source src = new GameData.Source(id, name, version, root, false);
        src.enabled = enabled;
        d.sources.add(src);
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("source", src.toJson());
        r.put("created", created);
        return r;
    }

    private static Map<String, Object> Collections_identity(List<String> header) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (String h : header) m.put(h, h);
        return m;
    }

    private static Map<String, Object> counts(GameData d) {
        Map<String, Object> c = new LinkedHashMap<String, Object>();
        c.put("hulls", d.hullFiles.size());
        c.put("variants", d.variants.size());
        c.put("weapons", d.weapons.size());
        c.put("hullmods", d.hullmods.size());
        c.put("wings", d.wings.size());
        c.put("systems", d.systems.size());
        return c;
    }

    // ------------------------------------------------------------ http helpers

    static final java.util.Set<String> TEXT_EXT = new java.util.HashSet<String>(java.util.Arrays.asList(
            "ship", "skin", "variant", "wpn", "proj", "system", "faction", "json", "csv", "txt", "md", "java", "version"));

    /**
     * Opens a file with the user's text editor (if set and it's a text file) or the system default app,
     * or shows it selected in the file manager. Files with no associated app open in Notepad on Windows.
     */
    static Map<String, Object> openFile(Path p, boolean reveal, String textEditor) throws IOException {
        String os = System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT);
        String n = p.getFileName().toString(), ext = n.contains(".") ? n.substring(n.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT) : "";
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        if (reveal) {
            if (os.contains("win")) new ProcessBuilder("explorer.exe", "/select,", p.toString()).start();
            else if (os.contains("mac")) new ProcessBuilder("open", "-R", p.toString()).start();
            else new ProcessBuilder("xdg-open", p.getParent().toString()).start();
            r.put("how", "folder");
            return r;
        }
        if (textEditor != null && !textEditor.trim().isEmpty() && !"null".equals(textEditor) && TEXT_EXT.contains(ext)) {
            new ProcessBuilder(textEditor.trim(), p.toString()).start();
            r.put("how", "your text editor");
            return r;
        }
        if (os.contains("win")) {
            // default app if one is associated; otherwise Notepad for text formats or the "Open with" dialog
            try {
                if (!java.awt.GraphicsEnvironment.isHeadless() && java.awt.Desktop.isDesktopSupported()) { java.awt.Desktop.getDesktop().open(p.toFile()); r.put("how", "default app"); return r; }
            } catch (Exception e) { /* no association */ }
            if (TEXT_EXT.contains(ext)) { new ProcessBuilder("notepad.exe", p.toString()).start(); r.put("how", "Notepad"); }
            else { new ProcessBuilder("rundll32.exe", "shell32.dll,OpenAs_RunDLL", p.toString()).start(); r.put("how", "Open with"); }
        } else if (os.contains("mac")) { new ProcessBuilder("open", p.toString()).start(); r.put("how", "default app"); }
        else { new ProcessBuilder("xdg-open", p.toString()).start(); r.put("how", "default app"); }
        return r;
    }

    /** Opens a folder in the file manager. */
    static Map<String, Object> openFolder(Path dir) throws IOException {
        String os = System.getProperty("os.name", "").toLowerCase(java.util.Locale.ROOT);
        if (os.contains("win")) new ProcessBuilder("explorer.exe", dir.toString()).start();
        else if (os.contains("mac")) new ProcessBuilder("open", dir.toString()).start();
        else new ProcessBuilder("xdg-open", dir.toString()).start();
        Map<String, Object> r = new LinkedHashMap<String, Object>();
        r.put("how", "folder");
        return r;
    }

    /** Streams the mod folder as <folder>.zip (backups, VCS folders and OS junk left out). */
    private static void exportZip(HttpExchange ex, final Path root) throws IOException {
        final String top = root.getFileName().toString();
        ex.getResponseHeaders().set("Content-Type", "application/zip");
        ex.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + top.replaceAll("[^A-Za-z0-9 ._()-]", "_") + ".zip\"");
        ex.sendResponseHeaders(200, 0);
        try (java.util.zip.ZipOutputStream z = new java.util.zip.ZipOutputStream(ex.getResponseBody());
             java.util.stream.Stream<Path> st = Files.walk(root)) {
            for (Path p : (Iterable<Path>) st.sorted()::iterator) {
                String rel = root.relativize(p).toString().replace('\\', '/');
                if (rel.isEmpty()) continue;
                String low = rel.toLowerCase(java.util.Locale.ROOT);
                if (low.endsWith(".bak") || low.startsWith(".git") || low.contains("/.git") || low.endsWith("thumbs.db") || low.endsWith(".ds_store")) continue;
                if (Files.isDirectory(p)) { z.putNextEntry(new java.util.zip.ZipEntry(top + "/" + rel + "/")); z.closeEntry(); continue; }
                z.putNextEntry(new java.util.zip.ZipEntry(top + "/" + rel));
                Files.copy(p, z);
                z.closeEntry();
            }
        }
    }

    private static void staticFile(HttpExchange ex, String name) throws IOException {
        if (name.contains("..")) { send(ex, 403, "text/plain", new byte[0]); return; }
        InputStream in = Server.class.getResourceAsStream("/web/" + name);
        if (in == null) { send(ex, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8)); return; }
        send(ex, 200, mime(name), readAll(in));
    }

    private static void json(HttpExchange ex, Object o) throws IOException {
        send(ex, 200, "application/json; charset=utf-8", Json.write(o).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Content-Security-Policy: only the editor's own script files may run, so text from a mod's files can never execute
     * as script even if it reached the page unescaped. Also no framing by other sites, no sniffing, no referrer.
     */
    static void securityHeaders(HttpExchange ex) {
        com.sun.net.httpserver.Headers h = ex.getResponseHeaders();
        h.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                + "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
        h.set("X-Content-Type-Options", "nosniff");
        h.set("X-Frame-Options", "DENY");
        h.set("Referrer-Policy", "no-referrer");
    }

    private static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(code, body.length == 0 ? -1 : body.length);
        try (OutputStream os = ex.getResponseBody()) {
            if (body.length > 0) os.write(body);
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = i.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        }
    }

    private static Map<String, String> query(String raw) throws IOException {
        Map<String, String> m = new LinkedHashMap<String, String>();
        if (raw == null) return m;
        for (String part : raw.split("&")) {
            int e = part.indexOf('=');
            if (e < 0) m.put(URLDecoder.decode(part, "UTF-8"), "");
            else m.put(URLDecoder.decode(part.substring(0, e), "UTF-8"), URLDecoder.decode(part.substring(e + 1), "UTF-8"));
        }
        return m;
    }

    private static String mime(String n) {
        n = n.toLowerCase();
        if (n.endsWith(".html")) return "text/html; charset=utf-8";
        if (n.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (n.endsWith(".css")) return "text/css; charset=utf-8";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        return "application/octet-stream";
    }
}
