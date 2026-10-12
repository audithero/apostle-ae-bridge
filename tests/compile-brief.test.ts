import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// The compile pipeline is CommonJS (the CEP panel require()s it), so load it
// the same way. Runs and published briefs go to a temp dir, never the repo.
const require = createRequire(import.meta.url);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "apostle-compile-"));
process.env.APOSTLE_COMPILE_RUNS = path.join(TMP, "runs");
process.env.APOSTLE_BRIEFS_ROOT = path.join(TMP, "briefs");

const { capabilities } = require("../scripts/lib/capabilities.cjs");
const { compileSpec, findCue, tokens, makeAligner } = require("../scripts/lib/compile-spec.cjs");
const { validateSpec, validateTreatment, voFidelity } = require("../scripts/lib/validate-spec.cjs");
const compile = require("../scripts/compile-brief.cjs");

const REPO = path.resolve(__dirname, "..");

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const VO1 = "Customers can use their points to purchase gift cards from a range of popular retailers and brands. This gives customers the flexibility to turn points into value for everyday purchases.";
const VO2 = "To find out more, visit commbank.com.au/yello today.";

function baseSpec(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2, name: "TEST_VIDEO", slug: "test-video", briefId: "test-video",
    stage: "gallery", easeProfile: "curvaceous", timing: { mode: "wpm", wpm: 150 },
    sections: [{ id: "gift", title: "Gift cards" }, { id: "end", title: "End" }],
    beats: [
      { section: "gift", vo: VO1, moments: [
        { layout: "hero", glyph: "gift", super: "Points for gift cards." },
        { cue: "This gives customers the flexibility", layout: "iconRow", super: "Turn points into value.",
          tiles: [{ glyph: "basket", label: "Everyday" }, { glyph: "ticket", label: "Occasions" }, { glyph: "coin", label: "Future" }] }
      ] },
      { section: "end", vo: VO2, moments: [{ layout: "endcard", super: "Find out more.", url: "commbank.com.au/yello" }] }
    ],
    ...over
  };
}

describe("capabilities", () => {
  it("reads the vocabulary out of apostle.jsx", () => {
    const cap = capabilities();
    expect(cap.glyphs).toContain("gift");
    expect(cap.glyphs).toContain("arrowRight");
    expect(cap.glyphs.length).toBeGreaterThanOrEqual(20);
    // a comment with a colon sits right above this entry in the source
    expect(cap.easeProfiles).toContain("curvaceous");
    expect(cap.transits.whipOrbit).toBe(0.75);
    expect(Object.keys(cap.layouts)).toContain("compare");
  });
});

describe("compileSpec", () => {
  it("matches make-video.py byte for byte on every shipped CommBank spec", () => {
    const kit = JSON.parse(fs.readFileSync(path.join(REPO, "brands/commbank-yello-3.json"), "utf8"));
    const out = path.join(TMP, "parity");
    fs.mkdirSync(path.join(out, "beats"), { recursive: true });
    fs.mkdirSync(path.join(out, "moments"), { recursive: true });
    const dir = path.join(REPO, "briefs/commbank-yello/specs");
    for (const f of fs.readdirSync(dir)) {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const tmpSpec = path.join(out, f);
      fs.writeFileSync(tmpSpec, JSON.stringify({ ...spec, briefDir: out }));
      execFileSync("python3", ["scripts/make-video.py", tmpSpec], { cwd: REPO });
      const py = {
        beats: JSON.parse(fs.readFileSync(path.join(out, "beats", spec.slug + ".json"), "utf8")),
        moments: JSON.parse(fs.readFileSync(path.join(out, "moments", spec.slug + ".json"), "utf8"))
      };
      const r = compileSpec(spec, { kit, spokenWords: (t: string) => t.split(/\s+/).filter(Boolean).length });
      // fields the Node port adds on purpose
      delete r.beats.meta.easeProfile; delete r.beats.meta.timingMode; delete r.beats.brand.kitId; delete r.moments.meta.easeProfile;
      r.beats.meta.note = py.beats.meta.note; r.moments.meta.note = py.moments.meta.note;
      expect(JSON.stringify(r.beats), f).toBe(JSON.stringify(py.beats));
      expect(JSON.stringify(r.moments), f).toBe(JSON.stringify(py.moments));
    }
  });

  it("places cue moments by word position in wpm mode", () => {
    const r = compileSpec(baseSpec(), {});
    const sc = r.moments.scenes[0];
    expect(sc.moments).toHaveLength(2);
    const idx = findCue(tokens(VO1), "This gives customers the flexibility", 0);
    const frac = idx / tokens(VO1).length;
    const voSec = tokens(VO1).length / (150 / 60);
    // m2.from is a fraction of the beat duration, m2 starts idx/len through the VO
    expect(sc.moments[1].from * sc.beatDurationSec).toBeCloseTo(frac * voSec, 1);
    expect(sc.moments[1].voCue).toBe("This gives customers the flexibility");
    expect(sc.moments[1].why).toBeUndefined();
    expect(r.beats.beats[0].stylePreset).toBe("listBuild");
    expect(r.beats.beats[0].transitIn).toBe("none");
    expect(r.beats.beats[1].transitIn).toBe("lateralTruck");
  });

  it("raises short beats to the readability floor instead of letting AE stretch them", () => {
    const spec = baseSpec({ beats: [
      { vo: "One two three four five six seven eight nine ten.", moments: [{ layout: "statement", super: "One." }] },
      { vo: "Short.", transit: "crane", moments: [{ layout: "statement", super: "Short." }] },
      { vo: "Another line that is long enough to hold its own on screen for a while.", moments: [{ layout: "statement", super: "Another." }] }
    ], sections: [] });
    const r = compileSpec(spec, {});
    const b = r.beats.beats[1];
    // floor = 1.8 + crane 1.3 + 0.2 + next transit (crane rotation slot 2 -> crane) 1.3
    expect(b.durationSec).toBeGreaterThanOrEqual(1.8 + 1.3 + 0.2 + 1.0 - 1e-9);
    expect(r.warnings.filter((w: string) => w.includes("settled hold"))).toHaveLength(0);
  });

  it("aligns beats to a words.json even when whisper splits a brand name", () => {
    const words = [
      { w: "[", t0: 0, t1: 0.1 }, { w: "BL", t0: 0, t1: 0.1 }, { w: "ANK", t0: 0, t1: 0.1 }, { w: "]", t0: 0, t1: 0.1 },
      { w: "Hello", t0: 0.5, t1: 0.9 }, { w: "there", t0: 0.9, t1: 1.2 }, { w: ".", t0: 1.2, t1: 1.3 },
      { w: "For", t0: 2.0, t1: 2.2 }, { w: "Com", t0: 2.2, t1: 2.4 }, { w: "Bank", t0: 2.4, t1: 2.6 },
      { w: "customers", t0: 2.6, t1: 3.1 }, { w: "finding", t0: 3.1, t1: 3.5 }, { w: "the", t0: 3.5, t1: 3.6 },
      { w: "best", t0: 3.6, t1: 3.9 }, { w: "place", t0: 3.9, t1: 4.3 }
    ];
    const a = makeAligner(words);
    expect(a.locate("Hello there.", 0, null)).toBe(0.5);
    expect(a.locate("For CommBank customers, finding the best place", 0.3, null)).toBe(2.0);
  });
});

describe("validateSpec", () => {
  it("accepts a good spec", () => {
    const v = validateSpec(baseSpec(), { clientVO: VO1 + " " + VO2 });
    expect(v.errors).toEqual([]);
  });

  it("names the exact problem for each kind of model mistake", () => {
    const bad = baseSpec();
    bad.beats[0].moments[0].glyph = "rocket";
    bad.beats[0].moments[1].cue = "words that are not in the vo";
    bad.beats[1].moments[0].layout = "carousel3d";
    const v = validateSpec(bad, {});
    expect(v.errors.some((e: string) => e.includes("glyph 'rocket' does not exist"))).toBe(true);
    expect(v.errors.some((e: string) => e.includes("does not appear in this beat's vo"))).toBe(true);
    expect(v.errors.some((e: string) => e.includes("layout 'carousel3d'"))).toBe(true);
  });

  it("rejects VO the model reworded", () => {
    const v = validateSpec(baseSpec(), { clientVO: VO1.replace("popular", "leading") + " " + VO2 });
    expect(v.errors.some((e: string) => e.startsWith("VO is not verbatim"))).toBe(true);
    expect(voFidelity("the cat sat", "on the mat the cat sat down", "subset")).toBeNull();
    expect(voFidelity("the dog sat", "on the mat the cat sat down", "subset")).not.toBeNull();
  });

  it("validates every shipped CommBank spec without errors", () => {
    const dir = path.join(REPO, "briefs/commbank-yello/specs");
    for (const f of fs.readdirSync(dir)) {
      const v = validateSpec(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), {});
      expect(v.errors, f).toEqual([]);
    }
  });

  it("requires a voScript per video in the treatment", () => {
    const v = validateTreatment({ title: "t", logline: "l", audience: "a", objective: "o", tone: [], visualSystem: {}, videos: [{ slug: "x", name: "X", structure: [{}] }] }, {});
    expect(v.errors.some((e: string) => e.includes("voScript is required"))).toBe(true);
  });
});

describe("compile-brief pipeline (mock model)", () => {
  let runDir = "";
  beforeAll(async () => {
    const out = await compile.treatment({
      client: "Test Client", briefFile: "briefs/commbank-yello/video3-earning-deep-dive.md",
      brand: "brands/commbank-yello-3.json", provider: "mock"
    });
    runDir = out.runDir;
  });

  it("writes a treatment that carries the client's VO verbatim", () => {
    const t = JSON.parse(fs.readFileSync(path.join(runDir, "treatment.json"), "utf8"));
    expect(t.voSource).toBe("client");
    expect(fs.readFileSync(path.join(runDir, "treatment.md"), "utf8")).toContain("client script, verbatim");
  });

  it("refuses to compose before the treatment is approved", async () => {
    await expect(compile.spec({ runDir, provider: "mock" })).rejects.toThrow(/not approved/);
  });

  it("composes, compiles and publishes after approval", async () => {
    compile.approve({ runDir, by: "test" });
    const out = await compile.spec({ runDir, provider: "mock" });
    expect(out.videos).toHaveLength(1);
    const files = out.videos[0].files;
    const beats = JSON.parse(fs.readFileSync(path.resolve(REPO, files.beats), "utf8"));
    const moments = JSON.parse(fs.readFileSync(path.resolve(REPO, files.moments), "utf8"));
    expect(beats.beats.length).toBeGreaterThan(1);
    expect(beats.brand.fontHeadingPS).toBeTruthy();
    expect(moments.scenes.map((s: { beatId: string }) => s.beatId)).toEqual(beats.beats.map((b: { beatId: string }) => b.beatId));
    expect(fs.existsSync(path.join(process.env.APOSTLE_BRIEFS_ROOT as string, "test-client", "treatment.md"))).toBe(true);
  });

  it("re-asks the model with the validator's errors", async () => {
    let calls = 0;
    const flaky = {
      name: "flaky",
      async plan({ ctx }: { ctx: Record<string, unknown> }) {
        calls++;
        const good = JSON.parse(await compile.mockProvider.plan({ ctx }));
        if (calls === 1) good.beats[0].moments[0].glyph = "rocket";
        return JSON.stringify(good);
      }
    };
    // drive askJSON through spec() with an injected provider
    const prov = require("../scripts/lib/redesign-providers.cjs").planProviders;
    prov.flaky = flaky;
    const out = await compile.spec({ runDir, provider: "flaky" });
    delete prov.flaky;
    expect(calls).toBe(2);
    expect(out.videos[0].attempts).toBe(2);
  });
});
