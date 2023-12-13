import {fromHexString} from "@chainsafe/ssz";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeSlotsSinceEpochStart,
  computeStartSlotAtEpoch,
  getCurrentSlot,
} from "@lodestar/state-transition";
import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BLSPubkey, CommitteeIndex, Epoch, Root, Slot, ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {ExecutionStatus, IForkChoice} from "@lodestar/fork-choice";
import {IBeaconChain, ChainEvent, CheckpointHex} from "../../../chain/index.js";
import {SyncState} from "../../../sync/interface.js";
import {ApiError, NodeIsSyncing} from "../errors.js";
import {IClock} from "../../../util/clock.js";

export function computeSubnetForCommitteesAtSlot(
  slot: Slot,
  committeesAtSlot: number,
  committeeIndex: CommitteeIndex
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(slot);
  const committeesSinceEpochStart = committeesAtSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}

/**
 * Precompute all pubkeys for given `validatorIndices`. Ensures that all `validatorIndices` are known
 * before doing other expensive logic.
 *
 * Uses special BranchNodeStruct state.validators data structure to optimize getting pubkeys.
 * Type-unsafe: assumes state.validators[i] is of BranchNodeStruct type.
 * Note: This is the fastest way of getting compressed pubkeys.
 *       See benchmark -> packages/beacon-node/test/perf/api/impl/validator/attester.test.ts
 */
export function getPubkeysForIndices(
  validators: BeaconStateAllForks["validators"],
  indexes: ValidatorIndex[]
): BLSPubkey[] {
  const validatorsLen = validators.length; // Get once, it's expensive

  const pubkeys: BLSPubkey[] = [];
  for (let i = 0, len = indexes.length; i < len; i++) {
    const index = indexes[i];
    if (index >= validatorsLen) {
      throw Error(`validatorIndex ${index} too high. Current validator count ${validatorsLen}`);
    }

    // NOTE: This could be optimized further by traversing the tree optimally with .getNodes()
    const validator = validators.getReadonly(index);
    pubkeys.push(validator.pubkey);
  }

  return pubkeys;
}

/**
 * Compute ms to the next epoch.
 */
export function msToNextEpoch(clock: IClock): number {
  return -1 * clock.secFromSlot(computeStartSlotAtEpoch(clock.currentEpoch + 1)) * 1000;
}

/**
 * If advancing the local clock `MAX_API_CLOCK_DISPARITY_MS` ticks to the next epoch, wait for slot 0 of the next epoch.
 * Prevents a validator from not being able to get the attestater duties correctly if the beacon and validator clocks are off
 */
export async function waitForNextClosestEpoch({
  clock,
  maxClockDisparityMs,
}: {
  clock: IClock;
  maxClockDisparityMs: number;
}): Promise<void> {
  const toNextEpochMs = msToNextEpoch(clock);
  if (toNextEpochMs > 0 && toNextEpochMs <= maxClockDisparityMs) {
    await clock.waitForSlot(computeStartSlotAtEpoch(clock.currentEpoch + 1));
  }
}

export function currentEpochWithDisparity({
  clock,
  maxClockDisparityMs,
}: {
  clock: IClock;
  maxClockDisparityMs: number;
}): Epoch {
  if (clock.isCurrentSlotGivenTolerance(computeStartSlotAtEpoch(clock.currentEpoch + 1), maxClockDisparityMs, 0)) {
    return clock.currentEpoch + 1;
  } else {
    return clock.currentEpoch;
  }
}

/**
 * This function is called 1s before next epoch, usually at that time PrepareNextSlotScheduler finishes
 * so we should have checkpoint state, otherwise wait for up to the slot 1 of epoch.
 *      slot epoch        0            1
 *           |------------|------------|
 *                    ^  ^
 *                    |  |
 *                    |  |
 *                    | waitForCheckpointState (1s before slot 0 of epoch, wait until slot 1 of epoch)
 *                    |
 *              prepareNextSlot (4s before next slot)
 */
export async function waitForCheckpointState({
  chain,
  cpHex,
}: {
  chain: IBeaconChain;
  cpHex: CheckpointHex;
}): Promise<CachedBeaconStateAllForks | null> {
  const cpState = chain.regen.getCheckpointStateSync(cpHex);
  if (cpState) {
    return cpState;
  }
  const cp = {
    epoch: cpHex.epoch,
    root: fromHexString(cpHex.rootHex),
  };
  const slot0 = computeStartSlotAtEpoch(cp.epoch);
  // if not, wait for ChainEvent.checkpoint event until slot 1 of epoch
  let listener: ((eventCp: phase0.Checkpoint) => void) | null = null;
  const foundCPState = await Promise.race([
    new Promise((resolve) => {
      listener = (eventCp) => {
        resolve(ssz.phase0.Checkpoint.equals(eventCp, cp));
      };
      chain.emitter.once(ChainEvent.checkpoint, listener);
    }),
    // in rare case, checkpoint state cache may happen up to 6s of slot 0 of epoch
    // so we wait for it until the slot 1 of epoch
    chain.clock.waitForSlot(slot0 + 1),
  ]);

  if (listener != null) {
    chain.emitter.off(ChainEvent.checkpoint, listener);
  }

  if (foundCPState === true) {
    return chain.regen.getCheckpointStateSync(cpHex);
  }

  return null;
}

/**
 * Reject any request while the node is syncing
 */
export function isNodeSynced({
  currentSlot,
  headSlot,
  syncState,
  syncToleranceEpochs,
  raiseErrors,
}: {
  currentSlot: Slot;
  headSlot: Slot;
  syncState: SyncState;
  syncToleranceEpochs: number;
  raiseErrors: boolean;
}): boolean {
  // Consider node synced before or close to genesis
  if (currentSlot < SLOTS_PER_EPOCH) {
    return true;
  }

  switch (syncState) {
    case SyncState.SyncingFinalized:
    case SyncState.SyncingHead: {
      if (currentSlot - headSlot > syncToleranceEpochs * SLOTS_PER_EPOCH) {
        if (!raiseErrors) return false;
        throw new NodeIsSyncing(`headSlot ${headSlot} currentSlot ${currentSlot}`);
      } else {
        return true;
      }
    }

    case SyncState.Synced:
      return true;

    case SyncState.Stalled:
      if (!raiseErrors) return false;
      throw new NodeIsSyncing("waiting for peers");
  }
}

/**
 * Post merge, the CL and EL could be out of step in the sync, and could result in
 * Syncing status of the chain head. To be precise:
 * 1. CL could be ahead of the EL, with the validity of head payload not yet verified
 * 2. CL could be on an invalid chain of execution blocks with a non-existent
 *    or non-available parent that never syncs up
 *
 * Both the above scenarios could be problematic and hence validator shouldn't participate
 * or weigh its vote on a head till it resolves to a Valid execution status.
 * Following activities should be skipped on an Optimistic head (with Syncing status):
 * 1. Attestation if targetRoot is optimistic
 * 2. SyncCommitteeContribution if if the root for which to produce contribution is Optimistic.
 * 3. ProduceBlock if the parentRoot (chain's current head is optimistic). However this doesn't
 *    need to be checked/aborted here as assembleBody would call EL's api for the latest
 *    executionStatus of the parentRoot. If still not validated, produceBlock will throw error.
 *
 * TODO/PENDING: SyncCommitteeSignatures should also be aborted, the best way to address this
 *   is still in flux and will be updated as and when other CL's figure this out.
 */

export function isValidBeaconBlockRoot({
  forkChoice,
  beaconBlockRoot,
}: {
  forkChoice: IForkChoice;
  beaconBlockRoot: Root;
}): void {
  const protoBeaconBlock = forkChoice.getBlock(beaconBlockRoot);
  if (!protoBeaconBlock) {
    throw new ApiError(400, "Block not in forkChoice");
  }

  if (protoBeaconBlock.executionStatus === ExecutionStatus.Syncing)
    throw new NodeIsSyncing(
      `Block's execution payload not yet validated, executionPayloadBlockHash=${protoBeaconBlock.executionPayloadBlockHash} number=${protoBeaconBlock.executionPayloadNumber}`
    );
}
