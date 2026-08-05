import {describe, expect, it, vi} from "vitest";
import {IForkChoice} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BuilderCircuitBreaker} from "../../../src/chain/builderCircuitBreaker.js";
import {getFaultInspectionParams} from "../../../src/execution/builder/http.js";

describe("BuilderCircuitBreaker", () => {
  const faultInspectionWindow = 32;
  const allowedFaults = 8;
  const logger = testLogger("builderCircuitBreaker");

  function setup(stats: {blocksPresent: number; payloadsRevealed: number}) {
    const getPayloadRevealCounts = vi.fn().mockReturnValue(stats);
    const forkChoice = {getPayloadRevealCounts} as unknown as IForkChoice;
    const breaker = new BuilderCircuitBreaker(
      {faultInspectionWindow, allowedFaults},
      {forkChoice, logger, metrics: null}
    );
    return {breaker, getPayloadRevealCounts};
  }

  const testCases: [string, {blocksPresent: number; payloadsRevealed: number}, boolean][] = [
    ["empty window", {blocksPresent: 0, payloadsRevealed: 0}, false],
    ["full window, no faults", {blocksPresent: 32, payloadsRevealed: 32}, false],
    ["full window, faults at budget", {blocksPresent: 32, payloadsRevealed: 24}, false],
    ["full window, faults above budget", {blocksPresent: 32, payloadsRevealed: 23}, true],
    ["sparse window, faults within scaled budget", {blocksPresent: 8, payloadsRevealed: 6}, false],
    ["sparse window, faults above scaled budget", {blocksPresent: 8, payloadsRevealed: 5}, true],
    ["sparse window, all payloads unrevealed", {blocksPresent: 4, payloadsRevealed: 0}, true],
  ];

  for (const [name, stats, expected] of testCases) {
    it(`${name} - active=${expected}`, () => {
      const {breaker} = setup(stats);
      expect(breaker.isActive(100)).toBe(expected);
    });
  }

  it("inspects the window excluding the current slot", () => {
    const {breaker, getPayloadRevealCounts} = setup({blocksPresent: 32, payloadsRevealed: 32});
    breaker.isActive(100);
    expect(getPayloadRevealCounts).toHaveBeenCalledWith(100 - faultInspectionWindow, 99);
  });

  it("only updates once per slot", () => {
    const {breaker, getPayloadRevealCounts} = setup({blocksPresent: 32, payloadsRevealed: 32});
    expect(breaker.isActive(100)).toBe(false);

    getPayloadRevealCounts.mockReturnValue({blocksPresent: 32, payloadsRevealed: 0});
    expect(breaker.isActive(100)).toBe(false);
    expect(getPayloadRevealCounts).toHaveBeenCalledTimes(1);

    expect(breaker.isActive(101)).toBe(true);
    expect(getPayloadRevealCounts).toHaveBeenCalledTimes(2);
  });

  describe("getFaultInspectionParams", () => {
    it("caps allowed faults at a quarter of the fault inspection window", () => {
      expect(getFaultInspectionParams({faultInspectionWindow: 64, allowedFaults: 32})).toEqual({
        faultInspectionWindow: 64,
        allowedFaults: 16,
      });
    });

    it("enforces a minimum window of SLOTS_PER_EPOCH", () => {
      const params = getFaultInspectionParams({faultInspectionWindow: 1, allowedFaults: 1});
      expect(params.faultInspectionWindow).toBe(SLOTS_PER_EPOCH);
      expect(params.allowedFaults).toBe(1);
    });

    it("randomizes defaults within the recommended ranges", () => {
      const params = getFaultInspectionParams({});
      expect(params.faultInspectionWindow).toBeGreaterThanOrEqual(SLOTS_PER_EPOCH);
      expect(params.faultInspectionWindow).toBeLessThan(2 * SLOTS_PER_EPOCH);
      expect(params.allowedFaults).toBe(Math.floor(params.faultInspectionWindow / 4));
    });
  });
});
