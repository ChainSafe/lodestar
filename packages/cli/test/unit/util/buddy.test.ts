import {describe, expect, it} from "vitest";
import {Telemetry, buildState, computeMood, computeRare, spriteKindFor} from "../../../src/util/buddy/buddy.js";
import {formatFrame} from "../../../src/util/buddy/render.js";
import {renderSprite} from "../../../src/util/buddy/sprites.js";
import {Mood, RareSprite} from "../../../src/util/buddy/types.js";

function telemetry(overrides: Partial<Telemetry> = {}): Telemetry {
  return {
    slot: 100,
    peers: 30,
    isSyncing: false,
    syncDistance: 0,
    fork: "deneb",
    prevFork: "deneb",
    lastReorgSlot: null,
    ...overrides,
  };
}

describe("buddy / computeMood", () => {
  it("panic when peers === 0", () => {
    expect(computeMood(telemetry({peers: 0}))).toBe(Mood.panic);
  });
  it("sad when reorg within lookback", () => {
    expect(computeMood(telemetry({slot: 100, lastReorgSlot: 80}))).toBe(Mood.sad);
  });
  it("sleepy when syncing and far behind", () => {
    expect(computeMood(telemetry({isSyncing: true, syncDistance: 1000}))).toBe(Mood.sleepy);
  });
  it("happy default", () => {
    expect(computeMood(telemetry())).toBe(Mood.happy);
  });
  it("panic takes priority over sad", () => {
    expect(computeMood(telemetry({peers: 0, lastReorgSlot: 99}))).toBe(Mood.panic);
  });
  it("sad takes priority over sleepy", () => {
    expect(computeMood(telemetry({lastReorgSlot: 80, isSyncing: true, syncDistance: 1000}))).toBe(Mood.sad);
  });
  it("ignores stale reorg outside lookback", () => {
    expect(computeMood(telemetry({slot: 200, lastReorgSlot: 100}))).toBe(Mood.happy);
  });
});

describe("buddy / computeRare", () => {
  it("triggers on slot 1337", () => {
    expect(computeRare(telemetry({slot: 1337}))?.rare).toBe(RareSprite.slot1337);
  });
  it("triggers on slot 31337", () => {
    expect(computeRare(telemetry({slot: 31337}))?.rare).toBe(RareSprite.slot31337);
  });
  it("triggers on millionth slot", () => {
    expect(computeRare(telemetry({slot: 1_000_000}))?.rare).toBe(RareSprite.slotMillion);
  });
  it("triggers on 2 millionth slot with 2M label", () => {
    const r = computeRare(telemetry({slot: 2_000_000}));
    expect(r?.rare).toBe(RareSprite.slotMillion);
    expect(r?.label).toBe("2M");
  });
  it("triggers on fork activation slot", () => {
    expect(computeRare(telemetry({fork: "electra", prevFork: "deneb"}))?.rare).toBe(RareSprite.forkActivation);
  });
  it("returns null on ordinary slot", () => {
    expect(computeRare(telemetry({slot: 12345}))).toBeNull();
  });
});

describe("buddy / buildState + formatFrame", () => {
  it("formats sidecar frame with header, sprite, footer", () => {
    const state = buildState(telemetry({slot: 8123456, peers: 47, fork: "gloas"}));
    const sprite = renderSprite(spriteKindFor(state));
    const frame = formatFrame(state, sprite);
    expect(frame).toContain("[slot 8123456");
    expect(frame).toContain("peers 47");
    expect(frame).toContain("mood: happy");
    expect(frame).toContain("synced [ok]");
    expect(frame.split("\n").length).toBeGreaterThan(4);
  });
  it("shows syncing footer when not synced", () => {
    const state = buildState(telemetry({isSyncing: true, syncDistance: 100}));
    const frame = formatFrame(state, renderSprite(spriteKindFor(state)));
    expect(frame).toContain("syncing (100 behind)");
  });
  it("uses rare sprite when override present", () => {
    const state = buildState(telemetry({slot: 1337}));
    expect(state.override?.rare).toBe(RareSprite.slot1337);
    expect(spriteKindFor(state).kind).toBe("rare");
  });
});
