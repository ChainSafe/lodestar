import {describe, expect, it} from "vitest";
import {
  COMMITTEES_PER_ROUND,
  EMPTY_HEIGHT,
  FINALITY_FLAG_INDEX,
  PROGRESS_FLAG_INDEX,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_ROUND,
  TARGET_FLAG_INDEX,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {
  FINALITY_FLAG,
  PROGRESS_FLAG,
  TARGET_FLAG,
  computeBalanceWeightedSelection,
  computeEpochAtRound,
  computeRoundAtSlot,
  computeStartSlotAtRound,
  getBeaconCommitteeDecoupled,
  getHeightParticipationFlags,
  hasQuorum,
  isSlashableAttestationData2,
  isValidAttestationData,
  removeFlag,
} from "../../../src/util/decoupled.js";
import {naiveComputePayloadTimelinessCommitteeIndices} from "../../../src/util/seed.js";
import {DcHarness, ZERO_ROOT} from "./harness.js";

const rootA = new Uint8Array(32).fill(0xaa);
const rootB = new Uint8Array(32).fill(0xbb);
const empty = {height: EMPTY_HEIGHT, root: ZERO_ROOT};

describe("decoupled helpers", () => {
  it("round arithmetic", () => {
    expect(computeRoundAtSlot(0)).toBe(0);
    expect(computeRoundAtSlot(SLOTS_PER_ROUND - 1)).toBe(0);
    expect(computeRoundAtSlot(SLOTS_PER_ROUND)).toBe(1);
    expect(computeStartSlotAtRound(3)).toBe(3 * SLOTS_PER_ROUND);
    expect(computeEpochAtRound(SLOTS_PER_EPOCH / SLOTS_PER_ROUND)).toBe(1);
    expect(computeEpochAtRound(SLOTS_PER_EPOCH / SLOTS_PER_ROUND - 1)).toBe(0);
  });

  it("removeFlag", () => {
    expect(removeFlag(0b111, TARGET_FLAG_INDEX)).toBe(0b101);
    expect(removeFlag(0b100, FINALITY_FLAG_INDEX)).toBe(0b100);
    expect(FINALITY_FLAG | TARGET_FLAG | PROGRESS_FLAG).toBe(0b111);
    expect(PROGRESS_FLAG).toBe(1 << PROGRESS_FLAG_INDEX);
  });

  describe("isSlashableAttestationData2", () => {
    const cases: {
      name: string;
      d1: [typeof empty, typeof empty];
      d2: [typeof empty, typeof empty];
      slashable: boolean;
    }[] = [
      {
        name: "E2 conflicting targets",
        d1: [empty, {height: 3, root: rootA}],
        d2: [empty, {height: 3, root: rootB}],
        slashable: true,
      },
      {
        name: "same target twice",
        d1: [empty, {height: 3, root: rootA}],
        d2: [empty, {height: 3, root: rootA}],
        slashable: false,
      },
      {
        name: "empty vs named target",
        d1: [empty, {height: 3, root: ZERO_ROOT}],
        d2: [empty, {height: 3, root: rootA}],
        slashable: false,
      },
      {
        name: "different heights",
        d1: [empty, {height: 3, root: rootA}],
        d2: [empty, {height: 4, root: rootB}],
        slashable: false,
      },
      {
        name: "E1 finality vs target",
        d1: [{height: 3, root: rootA}, empty],
        d2: [empty, {height: 3, root: rootB}],
        slashable: true,
      },
      {
        name: "E1 finality vs empty target",
        d1: [{height: 3, root: rootA}, empty],
        d2: [empty, {height: 3, root: ZERO_ROOT}],
        slashable: true,
      },
      {
        name: "E1 reversed",
        d1: [empty, {height: 3, root: rootB}],
        d2: [{height: 3, root: rootA}, empty],
        slashable: true,
      },
      {
        name: "finality matching target",
        d1: [{height: 3, root: rootA}, empty],
        d2: [empty, {height: 3, root: rootA}],
        slashable: false,
      },
      {
        name: "empty finality never conflicts",
        d1: [{height: 3, root: ZERO_ROOT}, empty],
        d2: [empty, {height: 3, root: rootB}],
        slashable: false,
      },
      {
        name: "E1 within one attestation",
        d1: [
          {height: 3, root: rootA},
          {height: 3, root: rootB},
        ],
        d2: [
          {height: 3, root: rootA},
          {height: 3, root: rootB},
        ],
        slashable: true,
      },
    ];
    for (const {name, d1, d2, slashable} of cases) {
      it(name, () => {
        const data1 = {round: 0, finalizePair: d1[0], targetPair: d1[1]};
        const data2 = {round: 0, finalizePair: d2[0], targetPair: d2[1]};
        expect(isSlashableAttestationData2(data1, data2)).toBe(slashable);
        expect(isSlashableAttestationData2(data2, data1)).toBe(slashable);
      });
    }
  });

  describe("getHeightParticipationFlags", () => {
    const target = {height: 5, root: rootA};
    const justified = {height: 4, root: rootB};
    it("exact target vote earns target and progress", () => {
      expect(getHeightParticipationFlags({round: 0, finalizePair: empty, targetPair: target}, target, justified)).toBe(
        TARGET_FLAG | PROGRESS_FLAG
      );
    });
    it("empty target at the current height earns progress only", () => {
      expect(
        getHeightParticipationFlags(
          {round: 0, finalizePair: empty, targetPair: {height: 5, root: ZERO_ROOT}},
          target,
          justified
        )
      ).toBe(PROGRESS_FLAG);
    });
    it("finality vote for the justified pair earns finality", () => {
      expect(
        getHeightParticipationFlags({round: 0, finalizePair: justified, targetPair: empty}, target, justified)
      ).toBe(FINALITY_FLAG);
    });
    it("wrong height or root earns nothing", () => {
      expect(
        getHeightParticipationFlags(
          {round: 0, finalizePair: empty, targetPair: {height: 5, root: rootB}},
          target,
          justified
        )
      ).toBe(0);
      expect(
        getHeightParticipationFlags(
          {round: 0, finalizePair: empty, targetPair: {height: 4, root: ZERO_ROOT}},
          target,
          justified
        )
      ).toBe(0);
    });
  });

  describe("getBeaconCommitteeDecoupled", () => {
    it("partitions the eligible validators and rotates by one per round", () => {
      const h = new DcHarness(64);
      const committees0 = Array.from({length: COMMITTEES_PER_ROUND}, (_, i) =>
        getBeaconCommitteeDecoupled(h.state, 0, i)
      );
      const flat0 = committees0.flat();
      expect(flat0.length).toBe(64);
      expect(new Set(flat0).size).toBe(64);
      expect(committees0[0]).toEqual([0, 1, 2, 3]);

      const committees1 = Array.from({length: COMMITTEES_PER_ROUND}, (_, i) =>
        getBeaconCommitteeDecoupled(h.state, 1, i)
      );
      expect(committees1[0]).toEqual([1, 2, 3, 4]);
      expect(committees1[COMMITTEES_PER_ROUND - 1]).toEqual([61, 62, 63, 0]);
    });

    it("handles a validator count that does not divide evenly", () => {
      const h = new DcHarness(70);
      const sizes = Array.from(
        {length: COMMITTEES_PER_ROUND},
        (_, i) => getBeaconCommitteeDecoupled(h.state, 0, i).length
      );
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(70);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    });

    it("excludes validators exited at the finalized epoch but keeps later exits", () => {
      const h = new DcHarness(64);
      h.state.finalizedSlot = 2 * SLOTS_PER_EPOCH;
      h.state.validators.get(5).exitEpoch = 1;
      h.state.validators.get(6).exitEpoch = 2;
      h.state.validators.get(7).exitEpoch = 3;
      h.state.commit();
      const flat = Array.from({length: COMMITTEES_PER_ROUND}, (_, i) =>
        getBeaconCommitteeDecoupled(h.state, 0, i)
      ).flat();
      expect(flat).not.toContain(5);
      expect(flat).not.toContain(6);
      expect(flat).toContain(7);
      expect(flat.length).toBe(62);
    });
  });

  describe("hasQuorum", () => {
    function withFlags(h: DcHarness, indices: number[], flag: number): void {
      for (const i of indices) h.state.heightParticipation.set(i, flag);
      h.state.commit();
    }
    it("needs two thirds of the active balance", () => {
      const h = new DcHarness(64);
      withFlags(
        h,
        Array.from({length: 42}, (_, i) => i),
        TARGET_FLAG
      );
      expect(hasQuorum(h.state, TARGET_FLAG_INDEX)).toBe(false);
      withFlags(h, [42], TARGET_FLAG);
      expect(hasQuorum(h.state, TARGET_FLAG_INDEX)).toBe(true);
      expect(hasQuorum(h.state, PROGRESS_FLAG_INDEX)).toBe(false);
    });
    it("ignores slashed validators", () => {
      const h = new DcHarness(64);
      withFlags(
        h,
        Array.from({length: 43}, (_, i) => i),
        TARGET_FLAG
      );
      h.state.validators.get(0).slashed = true;
      h.state.commit();
      expect(hasQuorum(h.state, TARGET_FLAG_INDEX)).toBe(false);
    });
  });

  describe("isValidAttestationData", () => {
    it("accepts the justified pair as target and the finalized pair as finalize, rejects unknown roots", () => {
      const h = new DcHarness(64);
      h.produceBlock(1, {attestations: [h.vote(1, {voters: Array.from({length: 64}, (_, i) => i)})]});
      h.advanceTo(2);
      const {target, justified, finalized} = h.snapshot();
      const round = computeRoundAtSlot(2);
      expect(isValidAttestationData(h.state, {round, finalizePair: empty, targetPair: target})).toBe(true);
      expect(isValidAttestationData(h.state, {round, finalizePair: empty, targetPair: justified})).toBe(true);
      expect(isValidAttestationData(h.state, {round, finalizePair: finalized, targetPair: target})).toBe(true);
      expect(isValidAttestationData(h.state, {round, finalizePair: justified, targetPair: target})).toBe(true);
      expect(isValidAttestationData(h.state, {round, finalizePair: empty, targetPair: {height: 2, root: rootA}})).toBe(
        false
      );
      expect(
        isValidAttestationData(h.state, {round, finalizePair: empty, targetPair: {height: 7, root: ZERO_ROOT}})
      ).toBe(false);
      expect(isValidAttestationData(h.state, {round, finalizePair: {height: 1, root: rootA}, targetPair: target})).toBe(
        false
      );
      expect(isValidAttestationData(h.state, {round, finalizePair: empty, targetPair: empty})).toBe(false);
      expect(isValidAttestationData(h.state, {round: round + 1, finalizePair: empty, targetPair: target})).toBe(false);
    });

    it("accepts mixed pairs that match no state pair, see DC-ISSUES.md", () => {
      const h = new DcHarness(64);
      h.produceBlock(1, {attestations: [h.vote(1, {voters: Array.from({length: 64}, (_, i) => i)})]});
      h.advanceTo(2);
      const {target, justified} = h.snapshot();
      // the justified height with the target root passes the per-field checks
      const mixed = {height: justified.height, root: target.root};
      expect(
        isValidAttestationData(h.state, {round: computeRoundAtSlot(2), finalizePair: empty, targetPair: mixed})
      ).toBe(true);
      expect(getHeightParticipationFlags({round: 0, finalizePair: empty, targetPair: mixed}, target, justified)).toBe(
        0
      );
    });
  });

  it("computeBalanceWeightedSelection without shuffling matches the gloas PTC sampler", () => {
    const h = new DcHarness(64);
    const indices = h.state.epochCtx.currentShuffling.activeIndices;
    const seed = new Uint8Array(32).fill(7);
    const expected = naiveComputePayloadTimelinessCommitteeIndices(
      h.state.epochCtx.effectiveBalanceIncrements,
      indices,
      seed
    );
    const actual = computeBalanceWeightedSelection(
      h.state.epochCtx.effectiveBalanceIncrements,
      indices,
      seed,
      PTC_SIZE,
      false
    );
    expect(Array.from(actual)).toEqual(expected);
    const shuffled = computeBalanceWeightedSelection(
      h.state.epochCtx.effectiveBalanceIncrements,
      indices,
      seed,
      PTC_SIZE,
      true
    );
    expect(shuffled.length).toBe(PTC_SIZE);
    expect(ssz.ValidatorIndex.maxSize).toBeGreaterThan(0);
  });
});
