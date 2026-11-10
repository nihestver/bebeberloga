# SPDX-FileCopyrightText: 2026 Bebeberloga contributors
# SPDX-License-Identifier: Apache-2.0
"""Краткий ход прогона: размер, к/с, энкодер и причина ограничения по секундам. python3 scripts/peek.py <файл>..."""
import json
import sys

for path in sys.argv[1:]:
    d = json.load(open(path))
    print(d["name"])
    for s in d["streamer"]["samples"][:: max(1, len(d["streamer"]["samples"]) // 6)]:
        o = next((x for x in s["stats"] if x["type"] == "outbound-rtp" and x.get("frameWidth")), None) or {}
        print(
            "  ", o.get("frameWidth"), o.get("frameHeight"), o.get("framesPerSecond"), o.get("encoderImplementation"),
            "hw" if o.get("powerEfficientEncoder") else "sw", o.get("qualityLimitationReason"),
            round(o.get("targetBitrate", 0) / 1e6, 2), "захват", s["settings"].get("width"), s["settings"].get("height"),
        )
    v = d["viewer"]["stats"][-1]["video"] if d["viewer"]["stats"] else []
    i = next((x for x in v if x["type"] == "inbound-rtp"), {})
    print("   декодер:", i.get("decoderImplementation"), "hw" if i.get("powerEfficientDecoder") else "sw", "кадров с меткой:", len(d["viewer"]["frames"]), "без метки:", d["viewer"]["undecoded"])
