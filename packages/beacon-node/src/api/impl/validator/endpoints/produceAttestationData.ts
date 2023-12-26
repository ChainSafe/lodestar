import {fromHexString} from "@chainsafe/ssz";
import {ServerApi, routes} from "@lodestar/api";
import {computeEpochAtSlot, computeStartSlotAtEpoch, getBlockRootAtSlot} from "@lodestar/state-transition";
import {RegenCaller} from "../../../../chain/regen/interface.js";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildProduceAttestationData(
  {chain}: ApiModules,
  {notWhileSyncing, waitForSlotWithDisparity, notOnOptimisticBlockRoot}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["produceAttestationData"] {
  return async function produceAttestationData(committeeIndex, slot) {
    notWhileSyncing();

    await waitForSlotWithDisparity(slot); // Must never request for a future slot > currentSlot

    // This needs a state in the same epoch as `slot` such that state.currentJustifiedCheckpoint is correct.
    // Note: This may trigger an epoch transition if there skipped slots at the beginning of the epoch.
    const headState = chain.getHeadState();
    const headSlot = headState.slot;
    const attEpoch = computeEpochAtSlot(slot);
    const headBlockRootHex = chain.forkChoice.getHead().blockRoot;
    const headBlockRoot = fromHexString(headBlockRootHex);

    const beaconBlockRoot =
      slot >= headSlot
        ? // When attesting to the head slot or later, always use the head of the chain.
          headBlockRoot
        : // Permit attesting to slots *prior* to the current head. This is desirable when
          // the VC and BN are out-of-sync due to time issues or overloading.
          getBlockRootAtSlot(headState, slot);

    const targetSlot = computeStartSlotAtEpoch(attEpoch);
    const targetRoot =
      targetSlot >= headSlot
        ? // If the state is earlier than the target slot then the target *must* be the head block root.
          headBlockRoot
        : getBlockRootAtSlot(headState, targetSlot);

    // Check the execution status as validator shouldn't vote on an optimistic head
    // Check on target is sufficient as a valid target would imply a valid source
    notOnOptimisticBlockRoot(targetRoot);

    // To get the correct source we must get a state in the same epoch as the attestation's epoch.
    // An epoch transition may change state.currentJustifiedCheckpoint
    const attEpochState = await chain.getHeadStateAtEpoch(attEpoch, RegenCaller.produceAttestationData);

    return {
      data: {
        slot,
        index: committeeIndex,
        beaconBlockRoot,
        source: attEpochState.currentJustifiedCheckpoint,
        target: {epoch: attEpoch, root: targetRoot},
      },
    };
  };
}
