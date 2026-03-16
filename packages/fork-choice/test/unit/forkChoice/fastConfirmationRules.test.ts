import {describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {createFastConfirmationCache} from "../../../src/forkChoice/fastConfirmation/data.js";
import {
  advanceIfObservedJustified,
  advanceToLatestConfirmedDescendant,
  resetIfBehindOrNotAncestorOrUnsafe,
  resetIfConfirmedUnavailable,
} from "../../../src/forkChoice/fastConfirmation/rules.js";
import {FastConfirmationDecision} from "../../../src/forkChoice/fastConfirmation/types.js";
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

const BASE_DECISION: FastConfirmationDecision = {confirmedRoot: ZERO_ROOT, didReset: false};

describe("fast confirmation rules", () => {
  it("resetIfConfirmedUnavailable resets to finalized when confirmed block is unknown", () => {
    const state = makeState(16, 32, [1 as Slot]);
    const store = makeStore(rootFromNumber(99), ZERO_ROOT, ZERO_ROOT, 0, 0, ZERO_ROOT, ZERO_ROOT, state);
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
    const ctx = makeContext(
      1 as Slot,
      ZERO_ROOT,
      [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT})],
      new Map(),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    const result = resetIfConfirmedUnavailable(snapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: rootFromNumber(99),
    });

    expect(result).toEqual({confirmedRoot: ZERO_ROOT, didReset: true, reason: "confirmed_not_found"});
  });

  it("resetIfBehindOrNotAncestorOrUnsafe resets when confirmed block is older than previous epoch", () => {
    const oldConfirmed = makeBlock(1, ZERO_ROOT);
    const head = makeBlock(2 * SLOTS_PER_EPOCH, oldConfirmed.blockRoot);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), oldConfirmed, head];
    const state = makeState(32, 32, [head.slot]);
    const store = makeStore(
      oldConfirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      oldConfirmed.blockRoot,
      head.blockRoot,
      state
    );
    const snapshot = makeSnapshot(
      (2 * SLOTS_PER_EPOCH + 1) as Slot,
      2,
      head.blockRoot,
      oldConfirmed.blockRoot,
      oldConfirmed.slot,
      0,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      ZERO_ROOT,
      0
    );
    const ctx = makeContext(
      (2 * SLOTS_PER_EPOCH + 1) as Slot,
      head.blockRoot,
      blocks,
      new Map(),
      {epoch: 0, rootHex: ZERO_ROOT},
      state
    );

    const result = resetIfBehindOrNotAncestorOrUnsafe(snapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: oldConfirmed.blockRoot,
    });

    expect(result.confirmedRoot).toBe(ZERO_ROOT);
    expect(result.didReset).toBe(true);
    expect(result.reason).toBe("confirmed_reset");
  });

  it("resetIfBehindOrNotAncestorOrUnsafe only enforces chain safety at epoch start", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT);
    const head = makeBlock(SLOTS_PER_EPOCH, confirmed.blockRoot);
    const nonAncestorObserved = makeBlock(SLOTS_PER_EPOCH - 1, ZERO_ROOT, {blockRoot: rootFromNumber(999)});
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

    const midEpochSnapshot = makeSnapshot(
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
    );
    const startEpochSnapshot = makeSnapshot(
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
    );

    const midEpochResult = resetIfBehindOrNotAncestorOrUnsafe(
      midEpochSnapshot,
      ctx,
      store,
      createFastConfirmationCache(),
      {...BASE_DECISION, confirmedRoot: confirmed.blockRoot}
    );
    const epochStartResult = resetIfBehindOrNotAncestorOrUnsafe(
      startEpochSnapshot,
      ctx,
      store,
      createFastConfirmationCache(),
      {...BASE_DECISION, confirmedRoot: confirmed.blockRoot}
    );

    expect(midEpochResult).toEqual({...BASE_DECISION, confirmedRoot: confirmed.blockRoot});
    expect(epochStartResult.confirmedRoot).toBe(ZERO_ROOT);
    expect(epochStartResult.didReset).toBe(true);
  });

  it("advanceIfObservedJustified advances only when epoch-start preconditions hold", () => {
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
    const epochStartSnapshot = makeSnapshot(
      SLOTS_PER_EPOCH as Slot,
      1,
      head.blockRoot,
      confirmed.blockRoot,
      confirmed.slot,
      0,
      ZERO_ROOT,
      observed.blockRoot,
      0,
      observed.blockRoot,
      0
    );
    const midEpochSnapshot = makeSnapshot(
      (SLOTS_PER_EPOCH + 1) as Slot,
      1,
      head.blockRoot,
      confirmed.blockRoot,
      confirmed.slot,
      0,
      ZERO_ROOT,
      observed.blockRoot,
      0,
      observed.blockRoot,
      0
    );

    const advanced = advanceIfObservedJustified(epochStartSnapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: confirmed.blockRoot,
    });
    const unchanged = advanceIfObservedJustified(midEpochSnapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: confirmed.blockRoot,
    });

    expect(advanced.confirmedRoot).toBe(observed.blockRoot);
    expect(advanced.reason).toBe("observed_justified");
    expect(unchanged.confirmedRoot).toBe(confirmed.blockRoot);
  });

  it("advanceToLatestConfirmedDescendant ignores confirmed blocks older than previous epoch", () => {
    const oldConfirmed = makeBlock(1, ZERO_ROOT);
    const head = makeBlock(2 * SLOTS_PER_EPOCH, oldConfirmed.blockRoot);
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), oldConfirmed, head];
    const state = makeState(64, 32, [head.slot]);
    const store = makeStore(
      oldConfirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      oldConfirmed.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (2 * SLOTS_PER_EPOCH + 1) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(64, head.blockRoot, 2, 64),
      {epoch: 2, rootHex: head.blockRoot},
      state
    );
    const snapshot = makeSnapshot(
      (2 * SLOTS_PER_EPOCH + 1) as Slot,
      2,
      head.blockRoot,
      oldConfirmed.blockRoot,
      oldConfirmed.slot,
      0,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      head.blockRoot,
      2
    );

    const result = advanceToLatestConfirmedDescendant(snapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: oldConfirmed.blockRoot,
    });

    expect(result.confirmedRoot).toBe(oldConfirmed.blockRoot);
  });

  it("advanceToLatestConfirmedDescendant advances to the latest confirmed descendant when eligible", () => {
    const confirmed = makeBlock(SLOTS_PER_EPOCH - 2, ZERO_ROOT);
    const candidate = makeBlock(SLOTS_PER_EPOCH - 1, confirmed.blockRoot, {
      unrealizedJustifiedEpoch: 0,
      unrealizedJustifiedRoot: ZERO_ROOT,
    });
    const currentEpochBlock = makeBlock(SLOTS_PER_EPOCH, candidate.blockRoot, {
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
    const blocks = [makeBlock(0, ZERO_ROOT, {blockRoot: ZERO_ROOT}), confirmed, candidate, currentEpochBlock, head];
    const state = makeState(100, 32, [candidate.slot, currentEpochBlock.slot, head.slot]);
    const store = makeStore(
      confirmed.blockRoot,
      ZERO_ROOT,
      ZERO_ROOT,
      0,
      0,
      candidate.blockRoot,
      head.blockRoot,
      state
    );
    const ctx = makeContext(
      (SLOTS_PER_EPOCH + 2) as Slot,
      head.blockRoot,
      blocks,
      latestMessagesFor(100, candidate.blockRoot, 1, 100),
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

    const result = advanceToLatestConfirmedDescendant(snapshot, ctx, store, createFastConfirmationCache(), {
      ...BASE_DECISION,
      confirmedRoot: confirmed.blockRoot,
    });

    expect(result.confirmedRoot).toBe(candidate.blockRoot);
    expect(result.reason).toBe("confirmed_descendant");
  });
});
