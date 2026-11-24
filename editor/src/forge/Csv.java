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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** CSV reader for Starsector data files: quoted multi-line fields, '#' comment rows, blank-id rows skipped. */
public final class Csv {
    private Csv() {}

    public static List<List<String>> rows(String text) {
        if (text.startsWith("﻿")) text = text.substring(1);
        List<List<String>> out = new ArrayList<List<String>>();
        List<String> row = new ArrayList<String>();
        StringBuilder f = new StringBuilder();
        boolean q = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (q) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') { f.append('"'); i++; }
                    else q = false;
                } else f.append(c);
            } else if (c == '"') q = true;
            else if (c == ',') { row.add(f.toString()); f.setLength(0); }
            else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(f.toString()); f.setLength(0);
                out.add(row); row = new ArrayList<String>();
            } else f.append(c);
        }
        if (f.length() > 0 || !row.isEmpty()) { row.add(f.toString()); out.add(row); }
        return out;
    }

    /** A parsed record plus where it sits in the original text (start inclusive, end exclusive, including its newline). */
    public static final class Rec {
        public final List<String> cells; public final int start, end;
        Rec(List<String> cells, int start, int end) { this.cells = cells; this.start = start; this.end = end; }
    }

    /** Same parsing rules as rows(), but keeps each record's text span so one row can be replaced in place. */
    public static List<Rec> recordsWithSpans(String text) {
        List<Rec> out = new ArrayList<Rec>();
        List<String> row = new ArrayList<String>();
        StringBuilder f = new StringBuilder();
        boolean q = false;
        int start = 0, i = text.startsWith("\uFEFF") ? 1 : 0;
        start = i;
        for (; i < text.length(); i++) {
            char c = text.charAt(i);
            if (q) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') { f.append('"'); i++; }
                    else q = false;
                } else f.append(c);
            } else if (c == '"') q = true;
            else if (c == ',') { row.add(f.toString()); f.setLength(0); }
            else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(f.toString()); f.setLength(0);
                out.add(new Rec(row, start, i + 1));
                row = new ArrayList<String>();
                start = i + 1;
            } else f.append(c);
        }
        if (f.length() > 0 || !row.isEmpty()) { row.add(f.toString()); out.add(new Rec(row, start, text.length())); }
        return out;
    }

    public static String quote(String v) {
        if (v == null) return "";
        if (v.isEmpty()) return "";
        boolean need = v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0
                || v.startsWith(" ") || v.endsWith(" ") || v.startsWith("#");
        return need ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
    }

    public static String line(List<String> header, java.util.Map<String, ?> row) {
        StringBuilder b = new StringBuilder();
        for (int c = 0; c < header.size(); c++) {
            if (c > 0) b.append(',');
            Object v = row.get(header.get(c).trim());
            b.append(quote(v == null ? "" : String.valueOf(v)));
        }
        return b.toString();
    }

    /** Rows as header-keyed maps. Skips rows whose key column is empty or starts with '#'. */
    public static List<Map<String, String>> records(String text, String keyColumn) {
        List<List<String>> rows = rows(text);
        List<Map<String, String>> out = new ArrayList<Map<String, String>>();
        if (rows.isEmpty()) return out;
        List<String> header = rows.get(0);
        for (int r = 1; r < rows.size(); r++) {
            List<String> row = rows.get(r);
            Map<String, String> m = new LinkedHashMap<String, String>();
            for (int c = 0; c < header.size(); c++) {
                String h = header.get(c).trim();
                if (h.isEmpty()) continue;
                m.put(h, c < row.size() ? row.get(c) : "");
            }
            String key = m.get(keyColumn);
            if (key == null || key.trim().isEmpty() || key.trim().startsWith("#")) continue;
            out.add(m);
        }
        return out;
    }
}
