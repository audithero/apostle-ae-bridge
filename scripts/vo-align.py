#!/usr/bin/env python3
"""Measure a recorded voiceover so a build can be timed to it.

    python3 scripts/vo-align.py <out-dir> <audio1> [audio2 ...]

Writes <out-dir>/words.json and <out-dir>/sentences.json with absolute times
across the concatenated audio (each file butt-joined after the previous).

Why not just run whisper over the file: whisper-cpp's word timings silently
degrade to whole-integer values on some inputs, running past the end of the
file (V1 part 2 did exactly this). So we cut the audio at real silences first
— found from an RMS envelope, not silencedetect, which misses pauses under
its duration floor — transcribe each chunk, and offset the results. The chunk
boundaries are themselves measured, so the joins are trustworthy.

Requires: ffmpeg, whisper-cli (brew install whisper-cpp) and a ggml model at
~/.cache/whisper-cpp/ggml-small.en.bin
"""
import json
import math
import os
import re
import subprocess
import sys
import wave
import array

MODEL = os.path.expanduser("~/.cache/whisper-cpp/ggml-small.en.bin")
WIN = 0.02          # RMS window, seconds
PAUSE_DB = -45.0    # relative to peak
MIN_PAUSE = 0.18
SPLIT_PAUSE = 0.60  # only cut the audio at pauses at least this long
MAX_CHUNK = 30.0    # keep chunks inside whisper's window


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def to_wav(src, dst):
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", "16000", dst])


def envelope(wav):
    w = wave.open(wav)
    sr, nf = w.getframerate(), w.getnframes()
    d = array.array("h")
    d.frombytes(w.readframes(nf))
    w.close()
    win = int(sr * WIN)
    rms = []
    for i in range(0, len(d) - win, win):
        s = d[i:i + win]
        rms.append(math.sqrt(sum(x * x for x in s) / win))
    peak = max(rms) or 1.0
    return [20 * math.log10(max(r, 1e-6) / peak) for r in rms], len(d) / sr


def pauses(db, thr=PAUSE_DB, minlen=MIN_PAUSE):
    out, start = [], None
    for i, v in enumerate(db):
        if v < thr:
            if start is None:
                start = i
        else:
            if start is not None and (i - start) * WIN >= minlen:
                out.append((start * WIN, i * WIN))
            start = None
    if start is not None:
        out.append((start * WIN, len(db) * WIN))
    return out


def cut_points(db, dur):
    """Chunk boundaries: long pauses, forced to stay under MAX_CHUNK."""
    cand = [(a + b) / 2 for a, b in pauses(db) if b - a >= SPLIT_PAUSE]
    bounds, last = [0.0], 0.0
    for c in cand:
        if c - last < 1.0:
            continue
        if c - last > MAX_CHUNK:
            # no long pause in range — fall back to any pause we can find
            for a, b in pauses(db):
                mid = (a + b) / 2
                if last + 1.0 < mid < last + MAX_CHUNK:
                    bounds.append(mid)
                    last = mid
        bounds.append(c)
        last = c
    bounds.append(dur)
    return sorted(set(round(x, 2) for x in bounds))


def transcribe(wav, out_prefix):
    run(["whisper-cli", "-m", MODEL, "-f", wav, "-ml", "1",
         "-oj", "-of", out_prefix, "--no-prints"])
    d = json.load(open(out_prefix + ".json"))
    return [(s["offsets"]["from"] / 1000.0, s["offsets"]["to"] / 1000.0, s["text"])
            for s in d["transcription"]]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    outdir, srcs = sys.argv[1], sys.argv[2:]
    os.makedirs(outdir, exist_ok=True)
    words, offset = [], 0.0

    for n, src in enumerate(srcs):
        wav = os.path.join(outdir, f"part{n}.wav")
        to_wav(src, wav)
        db, dur = envelope(wav)
        bounds = cut_points(db, dur)
        print(f"  {os.path.basename(src)}: {dur:.2f}s, {len(bounds)-1} chunks")
        for i in range(len(bounds) - 1):
            a, b = bounds[i], bounds[i + 1]
            if b - a < 0.25:
                continue
            cw = os.path.join(outdir, f"p{n}c{i}.wav")
            run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ss", str(a), "-to", str(b), cw])
            for wa, wb, t in transcribe(cw, os.path.join(outdir, f"p{n}c{i}")):
                words.append((round(wa + a + offset, 3), round(wb + a + offset, 3), t))
        offset += dur

    words.sort(key=lambda x: x[0])
    json.dump(words, open(os.path.join(outdir, "words.json"), "w"))

    sents, cur, st = [], [], None
    for a, b, t in words:
        if st is None:
            st = a
        cur.append(t)
        if t.strip().endswith((".", "?", "!")):
            sents.append([round(st, 2), round(b, 2), "".join(cur).strip()])
            cur, st = [], None
    if cur:
        sents.append([round(st, 2), round(words[-1][1], 2), "".join(cur).strip()])
    json.dump(sents, open(os.path.join(outdir, "sentences.json"), "w"), indent=1)

    print(f"\n  {len(words)} words, {len(sents)} sentences, {offset:.2f}s total")
    for a, b, t in sents:
        print(f"   [{a:7.2f} - {b:7.2f}] {t[:96]}")


if __name__ == "__main__":
    main()
