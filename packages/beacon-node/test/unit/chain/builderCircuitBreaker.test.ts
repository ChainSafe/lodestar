import {describe, expect, it, vi} from "vitest";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BuilderCircuitBreaker} from "../../../src/chain/builderCircuitBreaker.js";
import {getFaultInspectionParams} from "../../../src/execution/builder/http.js";

describe("BuilderCircuitBreaker", () => {
  const faultInspectionWindow = 32;
  const allowedFaults = 8;
  const logger = testLogger("builderCircuitBreaker");
  const head = {} as ProtoBlock;

  function setup(counts: {full: number; empty: number}) {
    const getCanonicalPayloadCounts = vi.fn().mockReturnValue(counts);
    const forkChoice = {getCanonicalPayloadCounts} as unknown as IForkChoice;
    const breaker = new BuilderCircuitBreaker(
      {faultInspectionWindow, allowedFaults},
      {forkChoice, logger, metrics: null}
    );
    return {breaker, getCanonicalPayloadCounts};
  }

  const testCases: [string, {full: number; empty: number}, boolean][] = [
    ["empty window keeps initial state", {full: 0, empty: 0}, false],
    ["full window, no faults", {full: 32, empty: 0}, false],
    ["full window, faults at budget", {full: 24, empty: 8}, false],
    ["full window, faults above budget", {full: 23, empty: 9}, true],
    ["sparse window, faults within scaled budget", {full: 6, empty: 2}, false],
    ["sparse window, faults above scaled budget", {full: 5, empty: 3}, true],
    ["single EMPTY block", {full: 0, empty: 1}, true],
    ["sparse window, all blocks EMPTY", {full: 0, empty: 4}, true],
  ];

  for (const [name, stats, expected] of testCases) {
    it(`${name} - active=${expected}`, () => {
      const {breaker} = setup(stats);
      expect(breaker.isActive(100, head)).toBe(expected);
    });
  }

  it("inspects the window excluding the current slot", () => {
    const {breaker, getCanonicalPayloadCounts} = setup({full: 32, empty: 0});
    breaker.isActive(100, head);
    expect(getCanonicalPayloadCounts).toHaveBeenCalledWith(100 - faultInspectionWindow, 99, head);
  });

  it("requires a minimum sample to deactivate", () => {
    const {breaker, getCanonicalPayloadCounts} = setup({full: 0, empty: 1});
    expect(breaker.isActive(100, head)).toBe(true);

    getCanonicalPayloadCounts.mockReturnValue({full: 0, empty: 0});
    expect(breaker.isActive(101, head)).toBe(true);

    getCanonicalPayloadCounts.mockReturnValue({full: 3, empty: 0});
    expect(breaker.isActive(102, head)).toBe(true);

    getCanonicalPayloadCounts.mockReturnValue({full: 3, empty: 1});
    expect(breaker.isActive(103, head)).toBe(false);
  });

  it("only updates once per slot", () => {
    const {breaker, getCanonicalPayloadCounts} = setup({full: 32, empty: 0});
    expect(breaker.isActive(100, head)).toBe(false);

    getCanonicalPayloadCounts.mockReturnValue({full: 0, empty: 32});
    expect(breaker.isActive(100, head)).toBe(false);
    expect(getCanonicalPayloadCounts).toHaveBeenCalledTimes(1);

    expect(breaker.isActive(101, head)).toBe(true);
    expect(getCanonicalPayloadCounts).toHaveBeenCalledTimes(2);
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
