#!/usr/bin/env python3
"""Turn a compact per-video spec into the beats + moments JSON the library eats.

    python3 scripts/make-video.py briefs/commbank-yello/specs/video2.json

The spec carries absolute VO seconds (measured by vo-align.py); this converts
them into the two things the library actually wants:

  * beats[].durationSec  — each beat runs to the NEXT beat's first spoken word,
    so the pauses between beats are held as scene tails instead of being
    swallowed. The last beat gets `tail` extra seconds of endcard hold.
  * moments[].from/.to   — fractions of the beat's VO window, because
    applyMoments derives seconds as (comp.duration - tailBuffer) * fraction.
    Keeping them fractional means a later retime doesn't invalidate the file.

Emits beats/<name>.json and moments/<name>.json next to the spec's briefs dir.
"""
import json
import os
import re
import sys

HEAD = 2.0          # computeTiming's fixed pre-roll before beat 1
TAIL_BUFFER = 6.0   # applyMoments' assumption: voDur = comp.duration - 6
TRANSITS = ["none", "lateralTruck", "crane", "whipOrbit", "dollyZoom"]
# readability floor enforced by computeTiming, mirrored here so we can warn
TRANSIT_SEC = {"dollyPush": 1.1, "lateralTruck": 1.0, "whipOrbit": 0.75,
               "crane": 1.3, "dollyZoom": 1.0, "none": 0.0}

LIST_PRESETS = {"iconRow", "chipRow", "compare", "hub", "device"}


def beat_id(text, n):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:36]).rstrip("-") or f"beat-{n}"


def main():
    spec = json.load(open(sys.argv[1]))
    # buildFromBeats appends its own _vNNN, so meta.masterName must be the BASE
    # name; everything that addresses the built comp (moments, VO placement)
    # needs the versioned one.
    name = spec["name"]
    built = name + spec.get("version", "_v001")
    out_dir = spec.get("briefDir", "briefs/commbank-yello")
    beats_in = spec["beats"]
    end = spec["end"]
    tail = spec.get("tail", 2.5)

    # A leading title card holds a SUPER the script specifies but the VO never
    # says. It runs BEFORE the first spoken word, so the voiceover has to be
    # pushed back by its length — otherwise beat 1's audio starts under the
    # title. Same idea for a trailing card after the last word.
    title = spec.get("titleCard")
    if title:
        beats_in = [{"start": beats_in[0]["start"] - title["dur"], "silent": True,
                     "section": beats_in[0].get("section"), "vo": "",
                     "transit": "none",
                     "moments": [{"id": "m1", "at": beats_in[0]["start"] - title["dur"],
                                  "layout": title.get("layout", "statement"),
                                  "super": title["super"], "sub": title.get("sub", "")}]}] + beats_in
        for b in beats_in[1:]:
            b.pop("transit", None) if b.get("transit") == "none" else None
    vo_offset = HEAD + (title["dur"] if title else 0.0)

    beats, scenes, warnings = [], [], []
    for i, b in enumerate(beats_in):
        nxt = beats_in[i + 1]["start"] if i + 1 < len(beats_in) else end
        dur = round(nxt - b["start"], 2)
        if i == len(beats_in) - 1:
            dur = round(dur + tail, 2)
        bid = b.get("id") or beat_id(b["vo"], i + 1)
        transit = b.get("transit", "none" if i == 0 else TRANSITS[1 + (i - 1) % 4])
        preset = b.get("preset")
        if not preset:
            preset = "listBuild" if any(m.get("layout") in LIST_PRESETS
                                        for m in b["moments"]) else "titleCard"
        entrance = "listCascade" if preset == "listBuild" else "fadeRise"

        nxt_transit = TRANSIT_SEC.get(
            beats_in[i + 1].get("transit", TRANSITS[1 + i % 4]), 1.0) if i + 1 < len(beats_in) else 0.0
        rest = dur - TRANSIT_SEC.get(transit, 1.0) - 0.2 - nxt_transit
        if rest < 1.8:
            warnings.append(f"beat {i+1} ({bid}) has only {rest:.2f}s of settled hold "
                            f"— computeTiming will stretch it and break VO lock")

        beats.append({
            "id": i + 1, "beatId": bid, "sectionId": b.get("section"),
            "vo": b["vo"], "superText": b["moments"][0]["super"],
            "voSpokenWords": len(b["vo"].split()),
            "silent": bool(b.get("silent")),
            "stylePreset": preset, "durationSec": dur,
            "voWindow": [round(b["start"], 2), round(nxt, 2)],
            "transitIn": transit,
            "motion": {"ease": "corporate-smooth", "entrance": entrance,
                       "exit": entrance, "handycam": "subtle"},
        })

        moments = []
        for k, m in enumerate(b["moments"]):
            at = m["at"]
            to = b["moments"][k + 1]["at"] if k + 1 < len(b["moments"]) else nxt
            if k == len(b["moments"]) - 1 and i == len(beats_in) - 1:
                to = nxt + tail          # endcard holds through the tail
            mm = {kk: vv for kk, vv in m.items() if kk != "at"}
            mm["from"] = round(max(0.0, at - b["start"]) / dur, 4)
            mm["to"] = round(min(dur, to - b["start"]) / dur, 4)
            mm["voSec"] = [round(at, 2), round(to, 2)]
            moments.append(mm)
        scenes.append({"beatId": bid, "beatDurationSec": dur, "moments": moments})

    kit = json.load(open("brands/commbank-yello-3.json"))
    total = round(HEAD + sum(b["durationSec"] for b in beats), 2)

    beats_doc = {
        "meta": {
            "schemaVersion": 2, "briefId": spec["briefId"], "scriptVersion": 1,
            "sourceScriptPath": spec.get("script"), "title": name,
            "fps": 25, "resolution": [1920, 1080], "wpm": 150,
            "layout": "gallery", "masterName": name, "rig": "auto",
            "brandKit": kit["kitId"],
            "note": "durationSec is MEASURED from the recorded VO, not estimated "
                    "from wpm. Each beat runs to the next beat's first spoken "
                    "word. VO layer sits at startTime meta.voOffsetSec.",
            "voOffsetSec": round(vo_offset, 2), "voFiles": spec.get("voFiles", []),
        },
        "sections": spec.get("sections", []),
        "brand": {k: kit[k] for k in ("fontHeadingPS", "fontBodyPS", "headingSize",
                                      "bodySize", "headingTracking", "bodyTracking",
                                      "safeMarginPct", "colors", "logo")},
        "beats": beats,
    }
    pal = dict(kit["moments"]["palette"])
    for k in ("tileShape", "tileFill", "plateFill", "plateStroke"):
        if k in kit["moments"]:
            pal[k] = kit["moments"][k]
    moments_doc = {
        "meta": {"briefId": spec["briefId"], "masterName": built, "scriptVersion": 1,
                 "voLeadIn": 0.45, "tailBuffer": TAIL_BUFFER,
                 "brandKit": kit["kitId"],
                 "note": "Windows are measured fractions of each beat's VO window."},
        "palette": pal,
        "scenes": scenes,
    }

    bp = os.path.join(out_dir, "beats", f"{spec['slug']}.json")
    mp = os.path.join(out_dir, "moments", f"{spec['slug']}.json")
    json.dump(beats_doc, open(bp, "w"), indent=1, ensure_ascii=False)
    json.dump(moments_doc, open(mp, "w"), indent=1, ensure_ascii=False)

    print(f"{built}: {len(beats)} beats, {sum(len(s['moments']) for s in scenes)} moments, "
          f"total {total}s (VO {round(vo_offset,2)}-{round(vo_offset+end,2)})")
    for w in warnings:
        print("  WARN", w)
    print(f"  -> {bp}\n  -> {mp}")


if __name__ == "__main__":
    main()
