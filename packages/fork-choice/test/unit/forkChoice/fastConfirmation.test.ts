import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {
  buildFastConfirmationSnapshot,
  createFastConfirmationCache,
} from "../../../src/forkChoice/fastConfirmation/data.js";
import {FastConfirmationRule} from "../../../src/forkChoice/fastConfirmation/fastConfirmationRule.js";
import {runFastConfirmationRules} from "../../../src/forkChoice/fastConfirmation/rules.js";
import {
  adjustCommitteeWeightEstimateToEnsureSafety,
  computeSafetyThreshold,
  findLatestConfirmedDescendant,
  getBlockSupportBetweenSlots,
  isConfirmedChainSafe,
  isOneConfirmed,
} from "../../../src/forkChoice/fastConfirmation/utils.js";
import {
  ZERO_ROOT,
  latestMessagesFor,
  makeBlock,
  makeContext,
  makeSnapshot,
  makeState,
  makeStore,
  rootFromNumber,
} from "./fastConfirmationTestUtils.js";

describe("fast confirmation", () => {
  it("computeSafetyThreshold applies the spec underflow guard", () => {
    const parent = makeBlock(1, ZERO_ROOT);
    const block = makeBlock(3, parent.blockRoot);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), parent, block];
    const state = makeState(32, 1, [2 as Slot, 3 as Slot]);
    const store = makeStore(parent.blockRoot, ZERO_ROOT, ZERO_ROOT, 0, 0, parent.blockRoot, block.blockRoot, state);
    const ctx = makeContext(
      4 as Slot,
      block.blockRoot,
      blocks,
      latestMessagesFor(32, parent.blockRoot, 0),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    const {threshold, maximumSupport, supportDiscount, adversarialWeight} = computeSafetyThreshold(
      ctx,
      store,
      createFastConfirmationCache(),
      {state, balances: state.epochCtx.effectiveBalanceIncrements},
      block.blockRoot
    );

    expect(maximumSupport).toBeGreaterThan(0);
    expect(supportDiscount).toBeGreaterThan(maximumSupport + 2 * adversarialWeight);
    expect(threshold).toBe(0);
  });

  it("adjustCommitteeWeightEstimateToEnsureSafety applies the spec safety bump in effective balance increments", () => {
    expect(adjustCommitteeWeightEstimateToEnsureSafety(999)).toBe(1004);
    expect(adjustCommitteeWeightEstimateToEnsureSafety(1001)).toBe(1007);
  });

  it("isOneConfirmed returns true only when support exceeds the computed threshold", () => {
    const block = makeBlock(1, ZERO_ROOT);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), block];
    const state = makeState(100, 32, [1 as Slot]);
    const store = makeStore(ZERO_ROOT, ZERO_ROOT, ZERO_ROOT, 0, 0, ZERO_ROOT, block.blockRoot, state);

    const enoughSupportCtx = makeContext(
      2 as Slot,
      block.blockRoot,
      blocks,
      latestMessagesFor(100, block.blockRoot, 0, 4),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );
    const lowSupportCtx = makeContext(
      2 as Slot,
      block.blockRoot,
      blocks,
      latestMessagesFor(100, block.blockRoot, 0, 2),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    expect(
      isOneConfirmed(
        enoughSupportCtx,
        store,
        createFastConfirmationCache(),
        {state, balances: state.epochCtx.effectiveBalanceIncrements},
        block.blockRoot,
        "current"
      )
    ).toBe(true);

    expect(
      isOneConfirmed(
        lowSupportCtx,
        store,
        createFastConfirmationCache(),
        {state, balances: state.epochCtx.effectiveBalanceIncrements},
        block.blockRoot,
        "current"
      )
    ).toBe(false);
  });

  it("getBlockSupportBetweenSlots counts validators whose latest message is exactly the target block", () => {
    const parent = makeBlock(1, ZERO_ROOT);
    const child = makeBlock(2, parent.blockRoot);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), parent, child];
    const state = makeState(4, 32, [2 as Slot]);
    const store = makeStore(parent.blockRoot, ZERO_ROOT, ZERO_ROOT, 0, 0, parent.blockRoot, child.blockRoot, state);
    const latestMessages = new Map([
      [0, {root: parent.blockRoot, epoch: 0}],
      [1, {root: parent.blockRoot, epoch: 0}],
      [2, {root: child.blockRoot, epoch: 0}],
      [3, {root: child.blockRoot, epoch: 0}],
    ]);
    const ctx = makeContext(3 as Slot, child.blockRoot, blocks, latestMessages, {epoch: 0, rootHex: ZERO_ROOT}, state);

    const support = getBlockSupportBetweenSlots(
      ctx,
      store,
      createFastConfirmationCache(),
      {state, balances: state.epochCtx.effectiveBalanceIncrements},
      parent.blockRoot,
      2 as Slot,
      2 as Slot
    );

    expect(support).toBe(64);
  });

  it("isConfirmedChainSafe fails when a block in the confirmed chain cannot be re-confirmed", () => {
    const observed = makeBlock(SLOTS_PER_EPOCH - 2, ZERO_ROOT);
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 1, observed.blockRoot);
    const head = makeBlock(SLOTS_PER_EPOCH, confirmed.blockRoot);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), observed, confirmed, head];
    const state = makeState(100, 32, [confirmed.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      observed.blockRoot,
      0,
      0,
      confirmed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (SLOTS_PER_EPOCH + 1) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(100, observed.blockRoot, 0, 2),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    expect(isConfirmedChainSafe(ctx, store, createFastConfirmationCache(), confirmed.blockRoot)).toBe(false);
  });

  it("runFastConfirmationRules resets to finalized when the confirmed block is unavailable", () => {
    const state = makeState(16, 32, [1 as Slot]);
    const store = makeStore(rootFromNumber(99), ZERO_ROOT, ZERO_ROOT, 0, 0, ZERO_ROOT, ZERO_ROOT, state);
    const ctx = makeContext(
      1 as Slot,
      ZERO_ROOT,
      [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT})],
      new Map(),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );
    const snapshot = makeSnapshot(
      1 as Slot,
      0,
      ZERO_ROOT,
      rootFromNumber(99),
      null,
      null,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      ZERO_ROOT,
      0
    );

    const result = runFastConfirmationRules(snapshot, ctx, store, createFastConfirmationCache());

    expect(result.confirmedRoot).toBe(ZERO_ROOT);
    expect(result.didReset).toBe(true);
  });

  it("runFastConfirmationRules advances to observed justified at epoch start", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 2, ZERO_ROOT);
    const observed = makeBlock(SLOTS_PER_EPOCH - 1, confirmed.blockRoot);
    const head = makeBlock(SLOTS_PER_EPOCH, observed.blockRoot, {
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: observed.blockRoot,
    });
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), confirmed, observed, head];
    const state = makeState(32, 32, [head.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      observed.blockRoot,
      0,
      0,
      observed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      SLOTS_PER_EPOCH as Slot,
      head.blockRoot,
      blocks,
      new Map(),
      {epoch: 0, rootHex: observed.blockRoot},
      state
    );

    const cache = createFastConfirmationCache();
    const snapshot = buildFastConfirmationSnapshot(ctx, store, cache);
    const result = runFastConfirmationRules(snapshot, ctx, store, cache);

    expect(result.confirmedRoot).toBe(observed.blockRoot);
    expect(result.didReset).toBe(true);
  });

  it("findLatestConfirmedDescendant falls back to loop 2 when previousSlotHead is on a sibling branch", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 2, ZERO_ROOT);
    const previousEpochCandidate = makeBlock(SLOTS_PER_EPOCH - 1, confirmed.blockRoot, {
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const previousSlotHead = makeBlock(SLOTS_PER_EPOCH - 1, confirmed.blockRoot, {
      blockRoot: rootFromNumber(10_000),
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const currentEpochBlock = makeBlock(SLOTS_PER_EPOCH, previousEpochCandidate.blockRoot, {
      justifiedEpoch: 0,
      justifiedRoot: ZERO_ROOT,
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const head = makeBlock(SLOTS_PER_EPOCH + 1, currentEpochBlock.blockRoot, {
      justifiedEpoch: 0,
      justifiedRoot: ZERO_ROOT,
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const blocks = [
      makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}),
      confirmed,
      previousEpochCandidate,
      previousSlotHead,
      currentEpochBlock,
      head,
    ];
    const state = makeState(100, 32, [previousEpochCandidate.slot, currentEpochBlock.slot, head.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      previousSlotHead.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (SLOTS_PER_EPOCH + 2) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(100, previousEpochCandidate.blockRoot, 1, 100),
      {epoch: 1, rootHex: currentEpochBlock.blockRoot},
      state
    );

    const snapshot = makeSnapshot(
      (SLOTS_PER_EPOCH + 2) as Slot,
      1,
      head.blockRoot,
      confirmed.blockRoot,
      confirmed.slot,
      0,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      null,
      null
    );

    const newConfirmed = findLatestConfirmedDescendant(
      snapshot,
      ctx,
      store,
      createFastConfirmationCache(),
      confirmed.blockRoot
    );

    expect(newConfirmed).toBe(previousEpochCandidate.blockRoot);
  });

  it("runFastConfirmationRules resets when the confirmed block is not an ancestor of head", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT);
    const head = makeBlock(SLOTS_PER_EPOCH, rootFromNumber(999));
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), confirmed, head];
    const state = makeState(32, 32, [head.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      confirmed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      SLOTS_PER_EPOCH as Slot,
      head.blockRoot,
      blocks,
      new Map(),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );
    const snapshot = makeSnapshot(
      SLOTS_PER_EPOCH as Slot,
      1,
      head.blockRoot,
      confirmed.blockRoot,
      confirmed.slot,
      0,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      ZERO_ROOT,
      0
    );

    const result = runFastConfirmationRules(snapshot, ctx, store, createFastConfirmationCache());

    expect(result.confirmedRoot).toBe(ZERO_ROOT);
    expect(result.didReset).toBe(true);
  });

  it("runFastConfirmationRules only resets an unsafe confirmed chain at epoch start", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT);
    const head = makeBlock(SLOTS_PER_EPOCH, confirmed.blockRoot);
    const nonAncestorObserved = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT, {blockRoot: rootFromNumber(4242)});
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), confirmed, head, nonAncestorObserved];
    const state = makeState(32, 32, [confirmed.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      nonAncestorObserved.blockRoot,
      0,
      0,
      confirmed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (SLOTS_PER_EPOCH + 1) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(32, confirmed.blockRoot, 0, 1),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    const midEpochResult = runFastConfirmationRules(
      makeSnapshot(
        (SLOTS_PER_EPOCH + 1) as Slot,
        1,
        head.blockRoot,
        confirmed.blockRoot,
        confirmed.slot,
        0,
        ZERO_ROOT,
        nonAncestorObserved.blockRoot,
        0,
        ZERO_ROOT,
        0
      ),
      ctx,
      store,
      createFastConfirmationCache()
    );

    const epochStartResult = runFastConfirmationRules(
      makeSnapshot(
        SLOTS_PER_EPOCH as Slot,
        1,
        head.blockRoot,
        confirmed.blockRoot,
        confirmed.slot,
        0,
        ZERO_ROOT,
        nonAncestorObserved.blockRoot,
        0,
        ZERO_ROOT,
        0
      ),
      ctx,
      store,
      createFastConfirmationCache()
    );

    expect(midEpochResult.confirmedRoot).toBe(confirmed.blockRoot);
    expect(midEpochResult.didReset).toBe(false);
    expect(epochStartResult.confirmedRoot).toBe(ZERO_ROOT);
    expect(epochStartResult.didReset).toBe(true);
  });

  it("runFastConfirmationRules keeps the confirmed block when the next descendant is not one-confirmed", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT);
    const head = makeBlock(SLOTS_PER_EPOCH, confirmed.blockRoot, {
      justifiedEpoch: 0,
      justifiedRoot: ZERO_ROOT,
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), confirmed, head];
    const state = makeState(100, 32, [head.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      confirmed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (SLOTS_PER_EPOCH + 1) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(100, head.blockRoot, 1, 2),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );
    const snapshot = makeSnapshot(
      (SLOTS_PER_EPOCH + 1) as Slot,
      1,
      head.blockRoot,
      confirmed.blockRoot,
      confirmed.slot,
      0,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      ZERO_ROOT,
      0
    );

    const result = runFastConfirmationRules(snapshot, ctx, store, createFastConfirmationCache());

    expect(result.confirmedRoot).toBe(confirmed.blockRoot);
    expect(result.didReset).toBe(false);
  });

  it("snapshots the greatest unrealized checkpoint at the last slot of the epoch", () => {
    const state = makeState(2, 32, [SLOTS_PER_EPOCH as Slot]);
    const previousObservedRoot = rootFromNumber(1);
    const currentObservedRoot = rootFromNumber(2);
    const greatestUnrealizedRoot = rootFromNumber(3);
    const unrealizedBalances = new Uint16Array([48, 64]);
    const store = makeStore(ZERO_ROOT, previousObservedRoot, currentObservedRoot, 0, 0, ZERO_ROOT, ZERO_ROOT, state, {
      previousGreatestUnrealizedRoot: rootFromNumber(99),
      previousGreatestUnrealizedEpoch: 0,
    });
    const ctx = makeContext(
      (SLOTS_PER_EPOCH - 1) as Slot,
      ZERO_ROOT,
      [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT})],
      new Map(),
      {epoch: 0, rootHex: greatestUnrealizedRoot},
      state,
      [],
      unrealizedBalances
    );

    new FastConfirmationRule(store, null).onSlotStartAfterPastAttestationsApplied(ctx);

    expect(store.previousEpochGreatestUnrealizedCheckpoint.rootHex).toBe(greatestUnrealizedRoot);
    expect(store.previousEpochGreatestUnrealizedCheckpoint.epoch).toBe(0);
    expect(store.previousEpochGreatestUnrealizedBalances).toBe(unrealizedBalances);
    expect(store.currentEpochObservedJustifiedCheckpoint.rootHex).toBe(currentObservedRoot);
    expect(store.previousEpochObservedJustifiedCheckpoint.rootHex).toBe(previousObservedRoot);
  });

  it("rotates observed justified checkpoints from the stored greatest unrealized snapshot at epoch start", () => {
    const state = makeState(2, 32, [SLOTS_PER_EPOCH as Slot]);
    const previousObservedRoot = rootFromNumber(11);
    const currentObservedRoot = rootFromNumber(12);
    const greatestUnrealizedRoot = rootFromNumber(13);
    const currentObservedBalances = new Uint16Array([32, 32]);
    const greatestUnrealizedBalances = new Uint16Array([48, 64]);
    const store = makeStore(ZERO_ROOT, previousObservedRoot, currentObservedRoot, 0, 0, ZERO_ROOT, ZERO_ROOT, state, {
      currentObservedBalances,
      previousGreatestUnrealizedRoot: greatestUnrealizedRoot,
      previousGreatestUnrealizedEpoch: 0,
      previousGreatestUnrealizedBalances: greatestUnrealizedBalances,
    });
    const ctx = makeContext(
      SLOTS_PER_EPOCH as Slot,
      ZERO_ROOT,
      [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT})],
      new Map(),
      {epoch: 1, rootHex: rootFromNumber(99)},
      state,
      []
    );

    new FastConfirmationRule(store, null).onSlotStartAfterPastAttestationsApplied(ctx);

    expect(store.previousEpochObservedJustifiedCheckpoint.rootHex).toBe(currentObservedRoot);
    expect(store.currentEpochObservedJustifiedCheckpoint.rootHex).toBe(greatestUnrealizedRoot);
    expect(store.previousEpochObservedJustifiedBalances).toBe(currentObservedBalances);
    expect(store.currentEpochObservedJustifiedBalances).toBe(greatestUnrealizedBalances);
  });
});
