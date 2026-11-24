/*
 * Starforge Data Export: companion mod for Starforge (exports hullmod description values).
 * Copyright (C) 2026 Claude
 * SPDX-License-Identifier: GPL-3.0-or-later
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
 * version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
 */
package forgeexport;

import org.apache.log4j.Logger;
import org.json.JSONArray;
import org.json.JSONObject;

import com.fs.starfarer.api.BaseModPlugin;
import com.fs.starfarer.api.Global;
import com.fs.starfarer.api.combat.HullModEffect;
import com.fs.starfarer.api.combat.ShipAPI.HullSize;
import com.fs.starfarer.api.loading.HullModSpecAPI;

/**
 * Export-only companion for Starforge. At game start, exports hullmod description values (the "%s" parts, which only the game's
 * scripts can compute) to saves/common/forge_bridge/hullmods.json for the editor.
 */
public class ForgeDataExportPlugin extends BaseModPlugin {
    public static final String HULLMODS_EXPORT = "forge_bridge/hullmods.json";
    private static final HullSize[] SIZES = {HullSize.FRIGATE, HullSize.DESTROYER, HullSize.CRUISER, HullSize.CAPITAL_SHIP};
    private static final Logger log = Global.getLogger(ForgeDataExportPlugin.class);

    @Override
    public void onApplicationLoad() throws Exception {
        try {
            exportHullmods();
        } catch (Throwable t) {
            log.warn("Starforge Data Export: hullmod export failed: " + t);
        }
    }

    private static void exportHullmods() throws Exception {
        JSONObject out = new JSONObject();
        out.put("time", System.currentTimeMillis());
        JSONObject mods = new JSONObject();
        int count = 0;
        for (HullModSpecAPI spec : Global.getSettings().getAllHullModSpecs()) {
            try {
                JSONObject m = new JSONObject();
                m.put("name", spec.getDisplayName());
                m.put("format", spec.getDescriptionFormat());
                String fmt = spec.getDescriptionFormat();
                int slots = fmt == null ? 0 : countParams(fmt);
                HullModEffect effect = spec.getEffect();
                JSONObject params = new JSONObject();
                for (HullSize size : SIZES) {
                    JSONArray p = new JSONArray();
                    for (int i = 0; i < slots; i++) {
                        String v;
                        try {
                            v = effect == null ? null : effect.getDescriptionParam(i, size);
                        } catch (Throwable t) {
                            v = null;
                        }
                        p.put(v == null ? JSONObject.NULL : v);
                    }
                    params.put(size.name(), p);
                }
                m.put("params", params);
                mods.put(spec.getId(), m);
                count++;
            } catch (Throwable t) {
                log.warn("Starforge Data Export: skipped hullmod " + spec.getId() + ": " + t);
            }
        }
        out.put("hullmods", mods);
        Global.getSettings().writeTextFileToCommon(HULLMODS_EXPORT, out.toString());
        log.info("Starforge Data Export: exported " + count + " hullmod descriptions");
    }

    private static int countParams(String fmt) {
        int n = 0;
        for (int i = fmt.indexOf("%s"); i >= 0; i = fmt.indexOf("%s", i + 2)) n++;
        return n;
    }
}
