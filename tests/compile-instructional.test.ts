import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { compileInstructional, captionChunks } = require("../scripts/lib/compile-instructional.cjs");
const { tokens } = require("../scripts/lib/compile-spec.cjs");
const REPO = path.resolve(__dirname, "..");
const kit = JSON.parse(fs.readFileSync(path.join(REPO, "brands/commbank.json"), "utf8"));

const plan = {
  name: "T", version: "v001", kit: "brands/commbank.json", totalSteps: 2, screens: [],
  open: { heading: ["Open"], dur: 3 },
  beats: [
    { vo: "Before you begin make sure you have an Australian phone number and an Australian address.",
      chapter: { step: 1, title: "Before you begin" },
      page: { heading: ["Have these", "ready"], highlight: "ready", items: "grid" },
      events: [
        { cue: "an Australian phone number", do: "item", glyph: "phone", title: "Phone" },
        { cue: "an Australian address", do: "item", glyph: "home", title: "Address" }
      ] },
    { vo: "Look for a small rectangle with a circle and line on the cover. Welcome to Australia.",
      chapter: { step: 2, title: "Check" },
      page: { heading: ["Check your", "passport"], highlight: "passport" },
      events: [
        { cue: "Look for a small", do: "prop", prop: "passport", label: "COVER" },
        { cue: "a circle and line", do: "pulse" },
        { cue: "Welcome to Australia", do: "outro" }
      ] }
  ]
};

describe("compileInstructional", () => {
  it("captions carry every word of the VO, in order, in short lines", () => {
    const vo = plan.beats.map((b) => b.vo).join(" ");
    const { timeline } = compileInstructional(plan, { repo: REPO, kit });
    expect(tokens(timeline.captions.map((c: { text: string }) => c.text).join(" "))).toEqual(tokens(vo));
    for (const c of timeline.captions) {
      expect(c.text.length).toBeLessThanOrEqual(95);
      expect(c.tOut).toBeGreaterThan(c.tIn);
    }
  });

  it("anchors events on their cue, after the chapter card has lifted", () => {
    const { timeline, warnings } = compileInstructional(plan, { repo: REPO, kit });
    expect(warnings).toEqual([]);
    expect(timeline.cards.map((c: { type: string }) => c.type)).toEqual(["title", "chapter", "chapter", "outro"]);
    const ch1 = timeline.cards[1];
    const [phoneItem, addrItem] = timeline.items;
    expect(phoneItem.tIn).toBeGreaterThan(ch1.tOut - 0.2);
    expect(addrItem.tIn).toBeGreaterThan(phoneItem.tIn);
    // everything on step 1 is gone while chapter 2 is fully opaque
    const ch2 = timeline.cards[2];
    expect(timeline.pages[0].tOut).toBeLessThanOrEqual(ch2.tIn + 0.5 + 1e-6);
    expect(timeline.props[0].events.map((e: { action: string }) => e.action)).toEqual(["pulse"]);
    expect(timeline.duration).toBeGreaterThan(timeline.cards[3].tIn);
  });

  it("splits a long sentence near the middle at a clause boundary", () => {
    const c = captionChunks("Hold the photo page of your passport up to the scanning area indicated on the screen and select scan passport.");
    expect(c.length).toBe(2);
    expect(c.join(" ")).toBe("Hold the photo page of your passport up to the scanning area indicated on the screen and select scan passport.");
  });
});
