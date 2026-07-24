import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconStateView, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {generateTestCachedBeaconStateOnlyValidators} from "@lodestar/state-transition/test-utils";
import {Epoch, Root, RootHex, Slot} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {CheckpointBalancesCache} from "../../../src/chain/balancesCache.js";

describe("CheckpointBalancesCache", () => {
  const gloasForkEpoch = 4;
  const config = getConfig(ForkName.gloas, gloasForkEpoch);

  const boundaryRoot = fromHex(`0x${"aa".repeat(32)}`);
  const branchARoot = fromHex(`0x${"bb".repeat(32)}`);
  const branchBRoot = fromHex(`0x${"cc".repeat(32)}`);

  /**
   * Build a state one slot into `epoch` that descends from `boundaryRoot` (last block of the
   * previous epoch) and has `firstSlotRoot` as the block at the first slot of `epoch`.
   */
  function stateAtEpoch(epoch: Epoch, firstSlotRoot: Root, vc: number): BeaconStateView {
    const startSlot = computeStartSlotAtEpoch(epoch);
    const state = generateTestCachedBeaconStateOnlyValidators({vc, slot: startSlot + 1});
    setBlockRoot(state, startSlot - 1, boundaryRoot);
    setBlockRoot(state, startSlot, firstSlotRoot);
    state.commit();
    return new BeaconStateView(state);
  }

  function setBlockRoot(state: {blockRoots: {set: (i: number, root: Root) => void}}, slot: Slot, root: Root): void {
    state.blockRoots.set(slot % SLOTS_PER_HISTORICAL_ROOT, root);
  }

  function checkpoint(epoch: Epoch, rootHex: RootHex): CheckpointWithHex {
    return {epoch, root: fromHex(rootHex), rootHex};
  }

  it("keys post-activation entries by the previous epoch boundary block", () => {
    const epoch = gloasForkEpoch + 1;
    const cache = new CheckpointBalancesCache(config);

    cache.processState(toRootHex(branchARoot), stateAtEpoch(epoch, branchARoot, 4));

    expect(cache.get(checkpoint(epoch, toRootHex(boundaryRoot)))).toBeDefined();
    // pre EIP-8333 keying must no longer be used, fork choice looks up the boundary root
    expect(cache.get(checkpoint(epoch, toRootHex(branchARoot)))).toBeUndefined();
  });

  it("dedupes branches sharing the same previous epoch boundary block", () => {
    const epoch = gloasForkEpoch + 1;
    const cache = new CheckpointBalancesCache(config);

    // both branches descend from `boundaryRoot` but have a different block at the first slot
    cache.processState(toRootHex(branchARoot), stateAtEpoch(epoch, branchARoot, 4));
    cache.processState(toRootHex(branchBRoot), stateAtEpoch(epoch, branchBRoot, 8));

    // second branch must not add a duplicate entry, the first one is retained
    expect(cache.get(checkpoint(epoch, toRootHex(boundaryRoot)))?.length).toBe(4);
    expect(cache.get(checkpoint(epoch, toRootHex(branchBRoot)))).toBeUndefined();
  });

  it("keys pre-activation entries by the first block of the epoch", () => {
    const epoch = gloasForkEpoch - 1;
    const cache = new CheckpointBalancesCache(config);

    cache.processState(toRootHex(branchARoot), stateAtEpoch(epoch, branchARoot, 4));

    expect(cache.get(checkpoint(epoch, toRootHex(branchARoot)))).toBeDefined();
    expect(cache.get(checkpoint(epoch, toRootHex(boundaryRoot)))).toBeUndefined();
  });
});
