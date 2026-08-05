import {describe, expect, it} from "vitest";
import {config as defaultConfig} from "@lodestar/config/default";
import {RootHex} from "@lodestar/types";
import {ForkChoice} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {gloasConfig, headSlot, makeStore, mockState, setup} from "./proposerHeadTestUtils.js";

/**
 * REORG_PARENT_WEIGHT_THRESHOLD is 160% of the per-slot committee weight. With 32 validators of 150
 * effective balance increments each and SLOTS_PER_EPOCH = 32 (mainnet preset), the threshold is:
 *   floor(floor((32 * 150) / 32) * 160 / 100) = floor(150 * 160 / 100) = 240
 */
const PARENT_THRESHOLD = 240;

/** isParentStrong is private; it is only reachable from getProposerHead */
function isParentStrong(forkChoice: ForkChoice, parentRoot: RootHex): boolean {
  return (forkChoice as unknown as {isParentStrong(parentRoot: RootHex): boolean}).isParentStrong(parentRoot);
}

describe("Forkchoice / isParentStrong", () => {
  describe("pre-gloas", () => {
    it("is strong when the boost-inclusive weight exceeds the threshold", () => {
      const {forkChoice, parentRoot} = setup({
        isGloas: false,
        config: defaultConfig,
        parentVotes: PARENT_THRESHOLD + 10,
      });
      expect(isParentStrong(forkChoice, parentRoot)).toBe(true);
    });

    it("is not strong when the weight only reaches the threshold, per the spec's strict >", () => {
      const {forkChoice, parentRoot} = setup({isGloas: false, config: defaultConfig, parentVotes: PARENT_THRESHOLD});
      expect(isParentStrong(forkChoice, parentRoot)).toBe(false);
    });

    it("counts proposer boost towards the weight, per phase0 get_weight", () => {
      // Attester votes alone are below the threshold, but the boost back-propagates from the head
      // and carries the parent over it
      const {forkChoice, parentRoot} = setup({
        isGloas: false,
        config: defaultConfig,
        parentVotes: 100,
        proposerBoost: {root: getBlockRoot(headSlot), score: 200},
      });
      expect(isParentStrong(forkChoice, parentRoot)).toBe(true);
    });
  });

  describe("gloas", () => {
    it("excludes proposer boost from the weight, per gloas get_attestation_score", () => {
      // Same numbers as the pre-gloas "counts proposer boost" case above, but gloas must ignore the
      // boost and still report the parent as not strong
      const {forkChoice, parentRoot} = setup({
        isGloas: true,
        config: gloasConfig,
        parentVotes: 100,
        proposerBoost: {root: getBlockRoot(headSlot), score: 200},
      });
      expect(isParentStrong(forkChoice, parentRoot)).toBe(false);
    });

    it("is strong when attester votes alone exceed the threshold", () => {
      const {forkChoice, parentRoot} = setup({
        isGloas: true,
        config: gloasConfig,
        parentVotes: PARENT_THRESHOLD + 10,
      });
      expect(isParentStrong(forkChoice, parentRoot)).toBe(true);
    });

    it("does not add back the weight of equivocating validators, unlike is_head_weak", () => {
      // 100 attester votes is below the threshold. is_head_weak would add 150 back for validator 0 and
      // clear 240; is_parent_strong has no such loop, so the parent stays not strong.
      const store = makeStore({equivocatingIndices: new Set([0]), state: mockState()});
      const {forkChoice, parentRoot} = setup({isGloas: true, config: gloasConfig, parentVotes: 100, store});
      expect(isParentStrong(forkChoice, parentRoot)).toBe(false);
    });
  });

  it("is not strong for a block that is not in fork choice, giving up the reorg rather than throwing", () => {
    const {forkChoice} = setup({isGloas: false, config: defaultConfig, parentVotes: PARENT_THRESHOLD + 10});
    const unknownRoot = getBlockRoot(headSlot + 100);

    expect(isParentStrong(forkChoice, unknownRoot)).toBe(false);
  });
});
