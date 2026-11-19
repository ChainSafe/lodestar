import {describe, expect, it} from "vitest";
import {config as defaultConfig} from "@lodestar/config/default";
import {RootHex} from "@lodestar/types";
import {ForkChoiceError, ForkChoiceErrorCode} from "../../../src/forkChoice/errors.js";
import {ForkChoice} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {gloasConfig, headSlot, makeStore, mockState, setup} from "./proposerHeadTestUtils.js";

/**
 * REORG_HEAD_WEIGHT_THRESHOLD is 20% of the per-slot committee weight. With 32 validators of 150
 * effective balance increments each and SLOTS_PER_EPOCH = 32 (mainnet preset), the threshold is:
 *   floor(floor((32 * 150) / 32) * 20 / 100) = floor(150 * 20 / 100) = 30
 */
const REORG_THRESHOLD = 30;

/** isHeadWeak is private; it is only reachable from getProposerHead / shouldApplyProposerBoost */
function isHeadWeak(forkChoice: ForkChoice, blockRoot: RootHex): boolean {
  return (forkChoice as unknown as {isHeadWeak(blockRoot: RootHex): boolean}).isHeadWeak(blockRoot);
}

describe("Forkchoice / isHeadWeak", () => {
  describe("pre-gloas", () => {
    it("is weak when the boost-inclusive weight is below the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: 10});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("is not weak when the boost-inclusive weight reaches the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: REORG_THRESHOLD});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("counts proposer boost towards the weight, per phase0 get_weight", () => {
      // Attester votes alone are weak, but the boost carries the block over the threshold
      const {forkChoice, headRoot} = setup({
        isGloas: false,
        config: defaultConfig,
        headVotes: 10,
        proposerBoost: {root: getBlockRoot(headSlot), score: BigInt(REORG_THRESHOLD) * 1_000_000_000n},
      });
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("is weak when the threshold exceeds its weight by less than one increment", () => {
      const store = makeStore();
      store.justified.totalBalance += 1;
      const {forkChoice, headRoot} = setup({
        isGloas: false,
        config: defaultConfig,
        headVotes: REORG_THRESHOLD,
        store,
      });
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("ignores equivocating validators, which are gloas-only", () => {
      const store = makeStore({equivocatingIndices: new Set([0, 1, 2]), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });
  });

  describe("gloas", () => {
    it("excludes proposer boost from the weight, per gloas get_attestation_score", () => {
      // Same numbers as the pre-gloas "counts proposer boost" case above, but gloas must ignore the
      // boost and still report the head as weak. This is the circularity gloas is_head_weak avoids:
      // gloas get_weight() gates the boost on should_apply_proposer_boost(), which calls this function.
      const {forkChoice, headRoot} = setup({
        isGloas: true,
        config: gloasConfig,
        headVotes: 10,
        proposerBoost: {root: getBlockRoot(headSlot), score: BigInt(REORG_THRESHOLD) * 1_000_000_000n},
      });
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("is not weak when attester votes alone reach the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: REORG_THRESHOLD});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("adds back the weight of equivocating validators in the block's committees", () => {
      // 10 attester votes is weak on its own, but 1 equivocating validator adds 150 back, clearing 120
      const store = makeStore({equivocatingIndices: new Set([0]), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("is weak when there are no equivocating validators to add back", () => {
      const store = makeStore({equivocatingIndices: new Set(), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("throws when the state needed for the add-back is unavailable", () => {
      // isHeadWeak only runs on the head, so the state is always cached
      const store = makeStore({equivocatingIndices: new Set([0]), state: null});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(() => isHeadWeak(forkChoice, headRoot)).toThrow(ForkChoiceError);
    });
  });

  it("throws for a block that is not in fork choice", () => {
    const {forkChoice} = setup({isGloas: false, config: defaultConfig, headVotes: 10});
    const unknownRoot = getBlockRoot(headSlot + 100);

    expect(() => isHeadWeak(forkChoice, unknownRoot)).toThrow(
      new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: unknownRoot})
    );
  });
});
