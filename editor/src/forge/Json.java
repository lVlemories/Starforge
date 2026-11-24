/*
 * Starforge: a Starsector ship, weapon and mod editor.
 * Copyright (C) 2026 Claude
 * SPDX-License-Identifier: GPL-3.0-or-later
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
 * version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
 */
package forge;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Lenient JSON reader matching what Starsector accepts: # and // and block comments,
 * trailing commas, unquoted keys and bare-word values. Produces Map/List/String/Double/Boolean/null.
 * Writer outputs strict JSON.
 */
public final class Json {
    private final String s;
    private int i = 0;

    private Json(String s) { this.s = s; }

    public static Object parse(String text) {
        if (text.startsWith("﻿")) text = text.substring(1);
        Json p = new Json(text);
        p.ws();
        Object v = p.value();
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Object o) { return o instanceof Map ? (Map<String, Object>) o : null; }
    @SuppressWarnings("unchecked")
    public static List<Object> arr(Object o) { return o instanceof List ? (List<Object>) o : null; }

    private RuntimeException err(String m) {
        int line = 1;
        for (int k = 0; k < Math.min(i, s.length()); k++) if (s.charAt(k) == '\n') line++;
        return new RuntimeException(m + " at line " + line);
    }

    private void ws() {
        while (i < s.length()) {
            char c = s.charAt(i);
            if (Character.isWhitespace(c)) i++;
            else if (c == '#') { while (i < s.length() && s.charAt(i) != '\n') i++; }
            else if (c == '/' && i + 1 < s.length() && s.charAt(i + 1) == '/') { while (i < s.length() && s.charAt(i) != '\n') i++; }
            else if (c == '/' && i + 1 < s.length() && s.charAt(i + 1) == '*') {
                int e = s.indexOf("*/", i + 2);
                i = e < 0 ? s.length() : e + 2;
            } else break;
        }
    }

    private Object value() {
        if (i >= s.length()) throw err("Unexpected end");
        char c = s.charAt(i);
        if (c == '{') return object();
        if (c == '[') return array();
        if (c == '"' || c == '\'') return string(c);
        return bare();
    }

    private Map<String, Object> object() {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        i++;
        while (true) {
            ws();
            if (i >= s.length()) throw err("Unterminated object");
            char c = s.charAt(i);
            if (c == '}') { i++; return m; }
            if (c == ',') { i++; continue; }
            String key;
            if (c == '"' || c == '\'') key = string(c);
            else {
                int st = i;
                while (i < s.length() && ":,}\n".indexOf(s.charAt(i)) < 0) i++;
                key = s.substring(st, i).trim();
            }
            ws();
            if (i < s.length() && (s.charAt(i) == ':' || s.charAt(i) == '=')) i++;
            else throw err("Expected ':' after key '" + key + "'");
            ws();
            m.put(key, value());
        }
    }

    private List<Object> array() {
        List<Object> a = new ArrayList<Object>();
        i++;
        while (true) {
            ws();
            if (i >= s.length()) throw err("Unterminated array");
            char c = s.charAt(i);
            if (c == ']') { i++; return a; }
            if (c == ',') { i++; continue; }
            a.add(value());
        }
    }

    private String string(char q) {
        StringBuilder b = new StringBuilder();
        i++;
        while (i < s.length()) {
            char c = s.charAt(i++);
            if (c == q) return b.toString();
            if (c == '\\' && i < s.length()) {
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u':
                        if (i + 4 <= s.length()) { b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; }
                        break;
                    default: b.append(e);
                }
            } else b.append(c);
        }
        throw err("Unterminated string");
    }

    private Object bare() {
        int st = i;
        while (i < s.length() && ",}]\n\r#".indexOf(s.charAt(i)) < 0) {
            if (s.charAt(i) == '/' && i + 1 < s.length() && (s.charAt(i + 1) == '/' || s.charAt(i + 1) == '*')) break;
            i++;
        }
        String t = s.substring(st, i).trim();
        if (t.isEmpty()) throw err("Unexpected character '" + s.charAt(st) + "'");
        if (t.equals("true")) return Boolean.TRUE;
        if (t.equals("false")) return Boolean.FALSE;
        if (t.equals("null")) return null;
        try {
            return Double.valueOf(t);
        } catch (NumberFormatException e) {
            return t;
        }
    }

    // ---------------- writer ----------------

    public static String write(Object o) {
        StringBuilder b = new StringBuilder();
        write(b, o, -1, 0);
        return b.toString();
    }

    public static String pretty(Object o) {
        StringBuilder b = new StringBuilder();
        write(b, o, 4, 0);
        return b.toString();
    }

    private static void nl(StringBuilder b, int indent, int depth) {
        if (indent < 0) return;
        b.append('\n');
        for (int k = 0; k < indent * depth; k++) b.append(' ');
    }

    private static void write(StringBuilder b, Object o, int indent, int depth) {
        if (o == null) b.append("null");
        else if (o instanceof String) quote(b, (String) o);
        else if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) b.append((long) d);
            else b.append(d);
        } else if (o instanceof Number || o instanceof Boolean) b.append(o);
        else if (o instanceof Map) {
            Map<?, ?> m = (Map<?, ?>) o;
            b.append('{');
            Iterator<? extends Map.Entry<?, ?>> it = m.entrySet().iterator();
            boolean first = true;
            while (it.hasNext()) {
                Map.Entry<?, ?> e = it.next();
                if (!first) b.append(',');
                first = false;
                nl(b, indent, depth + 1);
                quote(b, String.valueOf(e.getKey()));
                b.append(indent < 0 ? ":" : ": ");
                write(b, e.getValue(), indent, depth + 1);
            }
            if (!m.isEmpty()) nl(b, indent, depth);
            b.append('}');
        } else if (o instanceof List) {
            List<?> l = (List<?>) o;
            b.append('[');
            for (int k = 0; k < l.size(); k++) {
                if (k > 0) b.append(indent < 0 ? "," : ", ");
                write(b, l.get(k), indent, depth + 1);
            }
            b.append(']');
        } else quote(b, String.valueOf(o));
    }

    private static void quote(StringBuilder b, String s) {
        b.append('"');
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        b.append('"');
    }
}
