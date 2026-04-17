import {describe, expect, it} from "vitest";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {createFastConfirmationCache} from "../../../src/forkChoice/fastConfirmation/data.js";
import {FastConfirmationContext, ProtoNodeReadView} from "../../../src/forkChoice/fastConfirmation/types.js";
import {getAncestorRoots, precomputeChainAttestationScores} from "../../../src/forkChoice/fastConfirmation/utils.js";
import {ProtoBlock} from "../../../src/index.js";
import {NULL_VOTE_INDEX} from "../../../src/protoArray/interface.js";
import {ZERO_ROOT, makeBlock, makeContext, makeState, rootFromNumber} from "./fastConfirmationTestUtils.js";

/**
 * Regression tests for `precomputeChainAttestationScores`. Each fixture pairs an
 * input scenario with the exact per-block scores the algorithm should produce.
 * Originally this matrix compared output against the pre-optimization
 * `getAttestationScore` — now deleted — and the expected values here are the
 * ones that comparison produced.
 */
describe("precomputeChainAttestationScores", () => {
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
    /** Expected score per chain position, terminal-first. `undefined` means chain is empty. */
    expectedScores: number[] | undefined;
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
        // All 32 validators vote for tip. Suffix sum makes every chain position
        // see the full 32 × 32 = 1024 weight.
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
        // Chain terminal-first: [base, mid, tip]; all see 32×32.
        expectedScores: [1024, 1024, 1024],
      },
      {
        // 10 on tip, 10 on mid, 10 on base. Suffix sum:
        //   base  = 10 (tip) + 10 (mid) + 10 (base) = 30 × 32 = 960
        //   mid   = 10 (tip) + 10 (mid)             = 20 × 32 = 640
        //   tip   = 10 (tip)                         = 10 × 32 = 320
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
        expectedScores: [960, 640, 320],
      },
      {
        // 10 on tip + 10 on forkBlock (a sibling of `mid` under `base`).
        // Fork votes land at position 0 (base); tip votes land at position 2 (tip).
        //   base = 10 (tip) + 10 (fork) = 640
        //   mid  = 10 (tip)             = 320
        //   tip  = 10 (tip)             = 320
        name: "3) fork — off-chain votes land at the deepest shared ancestor",
        blocks: forkChain,
        validatorCount: 20,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: new Map([
          ...Array.from({length: 10}, (_, i) => [i, {root: tip.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 10}, (_, i) => [i + 10, {root: forkBlock.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
        expectedScores: [640, 320, 320],
      },
      {
        // 5 equivocators out of 32; only 27 × 32 = 864 count.
        name: "4) equivocators filtered",
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
        expectedScores: [864, 864, 864],
      },
      {
        // 5 slashed out of 32 — balance zeroed by getEffectiveBalanceIncrementsZeroInactive.
        // 27 × 32 = 864.
        name: "5) slashed filtered",
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
        expectedScores: [864, 864, 864],
      },
      {
        // Only half (16 of 32) have a latest message. The rest have
        // voteNextIndices[i] === NULL_VOTE_INDEX and are skipped.
        // 16 × 32 = 512.
        name: "6) validators without latest message are skipped",
        blocks: linear,
        validatorCount: 32,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: allVotingFor(16, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
        expectedScores: [512, 512, 512],
      },
      {
        // terminalRoot === chainTip → getAncestorRoots returns []; empty map.
        name: "7) degenerate chain — terminalRoot equals chainTip",
        blocks: linear,
        validatorCount: 16,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: allVotingFor(16, tip.blockRoot),
        chainTip: tip.blockRoot,
        terminalRoot: tip.blockRoot,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
        expectedScores: undefined,
      },
      {
        // Chain = [mid, tip] (terminal = base, excluded). forkBlock's parent is
        // base (slot 1, === terminalSlot), so the walk from forkBlock hits
        // base.slot <= terminalSlot and breaks without landing — fork votes are
        // dropped. Tip votes land at tip (position 1).
        //   mid = 0 (nothing lands at mid) + 320 (from suffix of tip) = 320
        //   tip = 320
        name: "8) shorter chain — fork votes break at terminalSlot",
        blocks: forkChain,
        validatorCount: 20,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        latestMessages: new Map([
          ...Array.from({length: 10}, (_, i) => [i, {root: tip.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 10}, (_, i) => [i + 10, {root: forkBlock.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: base.blockRoot,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
        expectedScores: [320, 320],
      },
      {
        // Indices 0,1 equivocating; 2,3 slashed. 4–13 vote tip, 14–18 vote mid,
        // 19–23 vote base, 24–28 vote fork, 29–39 are NULL_VOTE_INDEX.
        // Effective contributions (per-validator balance 32):
        //   tip: 10 validators at tip → 320
        //   mid: 5 validators at mid → 160
        //   base: 5 validators at base + 5 at fork (land at base) → 320
        // Suffix sum (terminal-first [base, mid, tip]):
        //   base = 320 + 160 + 320 = 800
        //   mid  = 320 + 160       = 480
        //   tip  = 320             = 320
        name: "9) mixed filters — equivocators + slashed + null votes + off-chain fork",
        blocks: forkChain,
        validatorCount: 40,
        balancePerValidator: 32,
        committeeSlots: [tip.slot],
        equivocatingIndices: [0, 1],
        slashedIndices: [2, 3],
        latestMessages: new Map([
          [0, {root: tip.blockRoot, epoch: 0}],
          [1, {root: tip.blockRoot, epoch: 0}],
          [2, {root: tip.blockRoot, epoch: 0}],
          [3, {root: tip.blockRoot, epoch: 0}],
          ...Array.from({length: 10}, (_, i) => [i + 4, {root: tip.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 5}, (_, i) => [i + 14, {root: mid.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 5}, (_, i) => [i + 19, {root: base.blockRoot, epoch: 0}] as const),
          ...Array.from({length: 5}, (_, i) => [i + 24, {root: forkBlock.blockRoot, epoch: 0}] as const),
        ]),
        chainTip: tip.blockRoot,
        terminalRoot: ZERO_ROOT,
        headRoot: tip.blockRoot,
        currentSlot: (tip.slot + 1) as Slot,
        expectedScores: [800, 480, 320],
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

      const precomputed = precomputeChainAttestationScores(
        ctx,
        cache,
        balanceSource,
        fixture.chainTip,
        fixture.terminalRoot
      );

      if (fixture.expectedScores === undefined) {
        expect(precomputed.size).toBe(0);
        return;
      }

      const chain = getAncestorRoots(ctx, cache, fixture.chainTip, fixture.terminalRoot);
      expect(chain.length, "chain length should match expected scores length").toBe(fixture.expectedScores.length);
      for (let i = 0; i < chain.length; i++) {
        expect(precomputed.get(chain[i]), `score at chain[${i}] (${chain[i]})`).toBe(fixture.expectedScores[i]);
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

    const precomputed = precomputeChainAttestationScores(ctx, cache, balanceSource, chainTip, terminalRoot);

    // Validator 0 voted for EMPTY variant of chainTip (node idx 2). Because
    // `indexToPosition` registers all three variants of chainTip at position 0,
    // the walk lands immediately at position 0, contributing balance 32 to
    // the suffix-sum score for chainTip.
    expect(precomputed.get(chainTip)).toBe(32);
  });
});
