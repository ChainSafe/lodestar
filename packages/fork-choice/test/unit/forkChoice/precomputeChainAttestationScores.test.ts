import {describe, expect, it} from "vitest";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {createFastConfirmationCache} from "../../../src/forkChoice/fastConfirmation/data.js";
import {FastConfirmationContext, ProtoNodeReadView} from "../../../src/forkChoice/fastConfirmation/types.js";
import {
  getAncestorRoots,
  getAttestationScore,
  precomputeChainAttestationScores,
} from "../../../src/forkChoice/fastConfirmation/utils.js";
import {ProtoBlock} from "../../../src/index.js";
import {NULL_VOTE_INDEX} from "../../../src/protoArray/interface.js";
import {ZERO_ROOT, makeBlock, makeContext, makeState, rootFromNumber} from "./fastConfirmationTestUtils.js";

/**
 * Equivalence test: `precomputeChainAttestationScores` must produce the same
 * per-block attestation scores as the legacy `ensureVoteMaps` + `getAttestationScore`
 * pair for every block on the chain, across a matrix of fixtures.
 *
 * Runs during the migration window (steps 3-5) while both implementations are live.
 * At step 6 (deletion), this file is rewritten to compare against hand-constructed
 * expected values instead of the deleted old code.
 */
describe("precomputeChainAttestationScores — equivalence with getAttestationScore", () => {
  type Fixture = {
    name: string;
    blocks: ProtoBlock[];
    validatorCount: number;
    balancePerValidator: number;
    committeeSlots: Slot[];
    slashedIndices?: ValidatorIndex[];
    equivocatingIndices?: ValidatorIndex[];
    latestMessages: Map<ValidatorIndex, {root: RootHex; epoch: Epoch}>;
    chainTip: RootHex;
    terminalRoot: RootHex;
    headRoot: RootHex;
    currentSlot: Slot;
  };

  function buildLinearChain(n: number): ProtoBlock[] {
    // chain: genesis (slot 0, ZERO_ROOT) ← block 1 ← block 2 ← … ← block n
    const blocks: ProtoBlock[] = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT})];
    for (let i = 1; i <= n; i++) {
      blocks.push(makeBlock(i, blocks[i - 1].blockRoot));
    }
    return blocks;
  }

  function allVotingFor(count: number, root: RootHex, epoch: Epoch = 0) {
    const out = new Map<ValidatorIndex, {root: RootHex; epoch: Epoch}>();
    for (let i = 0; i < count; i++) out.set(i, {root, epoch});
    return out;
  }

  function fixtures(): Fixture[] {
    const linear = buildLinearChain(3);
    const tip = linear.at(-1) as ProtoBlock;
    const mid = linear[2];
    const base = linear[1];

    // For off-chain fork fixtures.
    const forkChain: ProtoBlock[] = [...linear, makeBlock(2, base.blockRoot, {blockRoot: rootFromNumber(1000)})];
    const forkBlock = forkChain.at(-1) as ProtoBlock;

    return [
      {
        name: "1) linear chain — all votes on tip",
        blocks: linear,
        validatorCount: 32,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: allVotingFor(32, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "2) linear chain — votes spread across positions",
        blocks: linear,
        validatorCount: 30,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: new Map([
          ...Array.from({length: 10}, (_, i) => [i, {root: tip.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 10}, (_, i) => [i + 10, {root: mid.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 10}, (_, i) => [i + 20, {root: base.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "3) fork — some votes off the canonical chain (dropped equally)",
        blocks: forkChain,
        validatorCount: 20,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: new Map([
          ...Array.from({length: 10}, (_, i) => [i, {root: tip.blockRoot, epoch: 0}] as const),
          // 10 validators vote for the fork block — a descendant of `base`
          // (chain[0]), sibling of `mid` (chain[1]).
          ...Array.from({length: 10}, (_, i) => [i + 10, {root: forkBlock.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "4) equivocators present — filtered equally",
        blocks: linear,
        validatorCount: 32,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        equivocatingIndices: [0, 1, 2, 3, 4],
        latestMessages: allVotingFor(32, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "5) slashed validators — filtered equally",
        blocks: linear,
        validatorCount: 32,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        slashedIndices: [0, 1, 2, 3, 4],
        latestMessages: allVotingFor(32, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "6) validators without latest message — NULL_VOTE_INDEX, skipped equally",
        blocks: linear,
        validatorCount: 32,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        // Only half the validators have a latest message; the rest map to
        // NULL_VOTE_INDEX in the mock's voteNextIndices.
        latestMessages: allVotingFor(16, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "7) degenerate chain — terminalRoot === chainTip",
        blocks: linear,
        validatorCount: 16,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: allVotingFor(16, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: tip.blockRoot,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "8) off-chain fork deeper than terminal — walk break on terminalSlot",
        blocks: forkChain,
        validatorCount: 20,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: new Map([
          // 10 on tip
          ...Array.from({length: 10}, (_, i) => [i, {root: tip.blockRoot, epoch: 0}] as const),
          // 10 on the fork block — its walk goes forkBlock → base(chain[0]) → below terminal
          ...Array.from({length: 10}, (_, i) => [i + 10, {root: forkBlock.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        // Terminal is `base` — the fork block's walk hits `base` at position 0
        // after one step. We verify equivalence at the mid block.
        terminalRoot: base.blockRoot,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
      {
        name: "9) mixed filters — equivocators + slashed + null votes + off-chain fork",
        blocks: forkChain,
        validatorCount: 40,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        equivocatingIndices: [0, 1],
        slashedIndices: [2, 3],
        latestMessages: new Map([
          // 0,1 equivocate; 2,3 slashed — should all be filtered.
          [0, {root: tip.blockRoot, epoch: 0}],
          [1, {root: tip.blockRoot, epoch: 0}],
          [2, {root: tip.blockRoot, epoch: 0}],
          [3, {root: tip.blockRoot, epoch: 0}],
          // 4..13 vote for tip
          ...Array.from({length: 10}, (_, i) => [i + 4, {root: tip.blockRoot, epoch: 0}] as const),
          // 14..18 vote for mid
          ...Array.from({length: 5}, (_, i) => [i + 14, {root: mid.blockRoot, epoch: 0}] as const),
          // 19..23 vote for base
          ...Array.from({length: 5}, (_, i) => [i + 19, {root: base.blockRoot, epoch: 0}] as const),
          // 24..28 vote for the off-chain fork — descendant of base, sibling of mid
          ...Array.from({length: 5}, (_, i) => [i + 24, {root: forkBlock.blockRoot, epoch: 0}] as const),
          // 29..39 have no latest message → NULL_VOTE_INDEX
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
      },
    ];
  }

  for (const fixture of fixtures()) {
    it(fixture.name, () => {
      const state = makeState(
        fixture.validatorCount,
        fixture.balancePerValidator,
        fixture.committeeSlots,
        fixture.slashedIndices ?? []
      );
      const ctx = makeContext(
        fixture.currentSlot,
        fixture.headRoot,
        fixture.blocks,
        fixture.latestMessages,
        {epoch: 0, rootHex: ZERO_ROOT},
        state,
        fixture.equivocatingIndices ?? []
      );
      const balanceSource = {
        state,
        balances: state.effectiveBalanceIncrements,
        unslashedActiveBalances: state.getEffectiveBalanceIncrementsZeroInactive(),
      };
      const cache = createFastConfirmationCache();

      // New implementation.
      const precomputed = precomputeChainAttestationScores(
        ctx,
        cache,
        balanceSource,
        fixture.chainTip,
        fixture.terminalRoot,
        "current"
      );

      // For each block on the chain, the new map must agree with the old per-block
      // `getAttestationScore`. A separate cache for the old call prevents
      // cross-contamination of `voteWeightBySource` between new and old paths.
      const oldCache = createFastConfirmationCache();
      const chain = getAncestorRoots(ctx, cache, fixture.chainTip, fixture.terminalRoot);

      if (chain.length === 0) {
        expect(precomputed.size).toBe(0);
        return;
      }

      for (const root of chain) {
        const oldScore = getAttestationScore(ctx, oldCache, balanceSource, root, "current");
        expect(precomputed.get(root), `score mismatch for ${root}`).toEqual(oldScore);
      }
    });
  }

  it("Gloas variant collapse — vote for EMPTY variant lands at chain position registered for FULL", () => {
    // Direct unit test (not via the makeContext mock) to exercise `getNodeIndices`
    // returning multiple variant indices per root. Mimics a Gloas fixture where a
    // validator voted for an EMPTY variant while the canonical chain block
    // registers via FULL.
    const chainTip: RootHex = rootFromNumber(10);
    const terminalRoot: RootHex = rootFromNumber(1);
    const terminalSlot = 1 as Slot;

    // ProtoArray-like nodes. Indices 0 = terminal (FULL), 1 = block@slot 2 PENDING,
    // 2 = block@slot 2 EMPTY, 3 = block@slot 2 FULL. Chain passes through the block
    // at slot 2; voter points to the EMPTY variant (idx 2).
    const protoNodes: ProtoNodeReadView[] = [
      {parent: undefined, slot: terminalSlot, blockRoot: terminalRoot}, // terminal
      {parent: 0, slot: 2 as Slot, blockRoot: chainTip}, // PENDING
      {parent: 1, slot: 2 as Slot, blockRoot: chainTip}, // EMPTY
      {parent: 1, slot: 2 as Slot, blockRoot: chainTip}, // FULL
    ];
    const voteNextIndices = [2 /* validator 0 voted for EMPTY */, NULL_VOTE_INDEX];
    const unslashedActiveBalances = new Uint16Array([32, 32]);

    // Minimal context supplying just what the precompute function reads. Other
    // methods throw if called — the algorithm should never touch them.
    const unused = () => {
      throw new Error("unused accessor called");
    };
    const ctx: FastConfirmationContext = {
      config: {CONFIRMATION_BYZANTINE_THRESHOLD: 25, PROPOSER_SCORE_BOOST: 40},
      getCurrentSlot: () => 3 as Slot,
      getHead: unused as unknown as FastConfirmationContext["getHead"],
      getBlock: (root: RootHex) =>
        root === chainTip
          ? ({slot: 2 as Slot, blockRoot: chainTip, parentRoot: terminalRoot} as ProtoBlock)
          : root === terminalRoot
            ? ({slot: terminalSlot, blockRoot: terminalRoot, parentRoot: ZERO_ROOT} as ProtoBlock)
            : null,
      getAncestor: unused as unknown as FastConfirmationContext["getAncestor"],
      isDescendant: unused as unknown as FastConfirmationContext["isDescendant"],
      getLatestMessage: unused as unknown as FastConfirmationContext["getLatestMessage"],
      getUnrealizedJustified: unused as unknown as FastConfirmationContext["getUnrealizedJustified"],
      getFinalizedCheckpoint: unused as unknown as FastConfirmationContext["getFinalizedCheckpoint"],
      getEquivocatingIndices: () => new Set(),
      getTrackedVotesCount: () => 1,
      // The key accessor under test: chainTip maps to all three variant indices.
      getNodeIndices: (root) => (root === chainTip ? [1, 2, 3] : []),
      getProtoNodeView: () => ({nodes: protoNodes}),
      getVoteNextIndices: () => voteNextIndices,
    };
    const cache = createFastConfirmationCache();
    const balanceSource = {state: null, balances: unslashedActiveBalances, unslashedActiveBalances};

    const precomputed = precomputeChainAttestationScores(ctx, cache, balanceSource, chainTip, terminalRoot, "current");

    // Validator 0 voted for EMPTY variant of chainTip (node idx 2). Because
    // `indexToPosition` registers all three variants of chainTip at position 0,
    // the walk lands immediately at position 0, contributing balance 32 to
    // the suffix-sum score for chainTip.
    expect(precomputed.get(chainTip)).toBe(32);
  });
});
