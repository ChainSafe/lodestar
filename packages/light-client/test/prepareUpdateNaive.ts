import {altair, phase0, Root} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {FINALIZED_ROOT_GINDEX, NEXT_SYNC_COMMITTEE_GINDEX, SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {computeEpochAtSlot} from "../src/utils/clock";
import {getForkVersion} from "../src/utils/domain";

export interface IBeaconChainLc {
  getBlockHeaderByRoot(blockRoot: Root): Promise<phase0.BeaconBlockHeader>;
  getStateByRoot(stateRoot: Root): Promise<TreeBacked<altair.BeaconState>>;
}

/**
 * From a TreeBacked state, return an update to be consumed by a light client
 * Spec v1.0.1
 */
export async function prepareUpdateNaive(
  chain: IBeaconChainLc,
  blockWithSyncAggregate: altair.BeaconBlock
): Promise<altair.LightClientUpdate> {
  // update.syncCommitteeSignature signs over the block at the previous slot of the state it is included
  // ```py
  // previous_slot = max(state.slot, Slot(1)) - Slot(1)
  // domain = get_domain(state, DOMAIN_SYNC_COMMITTEE, compute_epoch_at_slot(previous_slot))
  // signing_root = compute_signing_root(get_block_root_at_slot(state, previous_slot), domain)
  // ```
  // Ref: https://github.com/ethereum/eth2.0-specs/blob/dev/specs/altair/beacon-chain.md#sync-committee-processing
  //
  // Then the lightclient will verify it signs over `signedHeader`, where
  // ```js
  // signedHeader = finalityHeaderSpecified ? update.finalityHeader : update.header
  // ```
  // So if we have a finalized block with `finalityHeader` we need to find a state such that
  // `state.getBlockRootAtSlot(state.slot - 1) == finalityHeader.root`, then find the block at `state.slot`

  // ┌────────────────────────┐  block.syncAggregate   ┌───────────────────────────────────────────┐
  // │ syncCommitteeSignature │ ◀───────────────────── │          blockWithSyncAggregate           │
  // └────────────────────────┘                        └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ block.stateRoot
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │          stateWithSyncAggregate           │
  //                                                   └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ state.getBlockRootAtSlot(state.slot - 1)
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │             syncAttestedBlock             │
  //                                                   └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ block.stateRoot
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │             syncAttestedState             │
  //                                                   └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ state.finalizedCheckpoint
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │         finalizedCheckpointBlock   <<<<   │
  //                                                   └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ block.stateRoot
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │         finalizedCheckpointState          │
  //                                                   └───────────────────────────────────────────┘
  //                                                     │
  //                                                     │ state.nextSyncCommittee
  //                                                     ▼
  //                                                   ┌───────────────────────────────────────────┐
  //                                                   │             nextSyncCommittee             │
  //                                                   └───────────────────────────────────────────┘

  const syncAggregate = blockWithSyncAggregate.body.syncAggregate;

  // Get the state that was processed with blockA
  const stateWithSyncAggregate = await chain.getStateByRoot(blockWithSyncAggregate.stateRoot);
  if (stateWithSyncAggregate === undefined) {
    throw Error("No state for blockA");
  }

  // Get the finality block root that sync committees have signed in blockA
  const syncAttestedSlot = stateWithSyncAggregate.slot - 1;
  // Inlined `getBlockRootAtSlot()`
  const syncAttestedBlockRoot = stateWithSyncAggregate.blockRoots[syncAttestedSlot % SLOTS_PER_HISTORICAL_ROOT];
  const syncAttestedBlockHeader = await chain.getBlockHeaderByRoot(syncAttestedBlockRoot);

  // Get the ForkVersion used in the syncAggregate, as verified in the state transition fn
  const syncAttestedEpoch = computeEpochAtSlot(syncAttestedSlot);
  const syncAttestedForkVersion = getForkVersion(stateWithSyncAggregate.fork, syncAttestedEpoch);

  // Get the finalized state defined in the block "attested" by the current sync committee
  const syncAttestedState = await chain.getStateByRoot(syncAttestedBlockHeader.stateRoot);
  const finalizedCheckpointBlockHeader = await chain.getBlockHeaderByRoot(syncAttestedState.finalizedCheckpoint.root);
  // Prove that the `finalizedCheckpointRoot` belongs in that block
  const finalityBranch = syncAttestedState.tree.getSingleProof(BigInt(FINALIZED_ROOT_GINDEX));

  // Get `nextSyncCommittee` from a finalized state so the lightclient can safely transition to the next committee
  const finalizedCheckpointState = await chain.getStateByRoot(finalizedCheckpointBlockHeader.stateRoot);
  // Prove that the `nextSyncCommittee` is included in a finalized state "attested" by the current sync committee
  const nextSyncCommitteeBranch = finalizedCheckpointState.tree.getSingleProof(BigInt(NEXT_SYNC_COMMITTEE_GINDEX));

  return {
    attestedHeader: syncAttestedBlockHeader,
    nextSyncCommittee: finalizedCheckpointState.nextSyncCommittee,
    nextSyncCommitteeBranch: nextSyncCommitteeBranch,
    finalizedHeader: finalizedCheckpointBlockHeader,
    finalityBranch: finalityBranch,
    syncAggregate,
    forkVersion: syncAttestedForkVersion,
  };
}
