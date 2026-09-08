import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {BeaconStateView, computeStartSlotAtEpoch, createCachedBeaconState} from "@lodestar/state-transition";
import {Root, Slot} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {getCheckpointFromState} from "../../../../../src/chain/blocks/utils/checkpoint.js";
import {generateState} from "../../../../utils/state.js";

describe("getCheckpointFromState", () => {
  const hezeForkEpoch = 4;
  const config = getConfig(ForkName.heze, hezeForkEpoch);
  const boundaryRoot = fromHex(`0x${"aa".repeat(32)}`);

  it("uses the previous epoch boundary root after Heze", () => {
    const checkpointSlot = computeStartSlotAtEpoch(hezeForkEpoch);
    const state = generateState({slot: checkpointSlot}, config);
    state.fork.epoch = hezeForkEpoch;
    setBlockRoot(state, checkpointSlot - 1, boundaryRoot);
    state.commit();

    const checkpoint = getCheckpointFromState(
      new BeaconStateView(
        createCachedBeaconState(state, {
          config: createBeaconConfig(config, state.genesisValidatorsRoot),
          pubkeyCache,
        })
      )
    );

    expect(checkpoint.epoch).toBe(hezeForkEpoch);
    expect(toRootHex(checkpoint.root)).toBe(toRootHex(boundaryRoot));
  });

  function setBlockRoot(state: {blockRoots: {set: (i: number, root: Root) => void}}, slot: Slot, root: Root): void {
    state.blockRoots.set(slot % SLOTS_PER_HISTORICAL_ROOT, root);
  }
});
