import {BitArray, byteArrayEquals} from "@chainsafe/ssz";

import {
  FINALIZED_ROOT_DEPTH,
  NEXT_SYNC_COMMITTEE_DEPTH,
  ForkSeq,
  ForkName,
  BLOCK_BODY_EXECUTION_PAYLOAD_DEPTH as EXECUTION_PAYLOAD_DEPTH,
  BLOCK_BODY_EXECUTION_PAYLOAD_INDEX as EXECUTION_PAYLOAD_INDEX,
} from "@lodestar/params";
import {altair, phase0, ssz, allForks, capella, deneb, Slot, electra} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {computeEpochAtSlot} from "@lodestar/state-transition";

import {isValidMerkleBranch, computeSyncPeriodAtSlot} from "../utils/index.js";
import {LightClientStore} from "./store.js";

export const GENESIS_SLOT = 0;
export const ZERO_HASH = new Uint8Array(32);
export const ZERO_PUBKEY = new Uint8Array(48);
export const ZERO_SYNC_COMMITTEE = ssz.altair.SyncCommittee.defaultValue();
export const ZERO_NEXT_SYNC_COMMITTEE_BRANCH = Array.from({length: NEXT_SYNC_COMMITTEE_DEPTH}, () => ZERO_HASH);
export const ZERO_HEADER = ssz.phase0.BeaconBlockHeader.defaultValue();
export const ZERO_FINALITY_BRANCH = Array.from({length: FINALIZED_ROOT_DEPTH}, () => ZERO_HASH);
/** From https://notes.ethereum.org/@vbuterin/extended_light_client_protocol#Optimistic-head-determining-function */
const SAFETY_THRESHOLD_FACTOR = 2;

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

export function getSafetyThreshold(maxActiveParticipants: number): number {
  return Math.floor(maxActiveParticipants / SAFETY_THRESHOLD_FACTOR);
}

export function isSyncCommitteeUpdate(update: allForks.LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.nextSyncCommitteeBranch !== ZERO_NEXT_SYNC_COMMITTEE_BRANCH &&
    update.nextSyncCommitteeBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isFinalityUpdate(update: allForks.LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.finalityBranch !== ZERO_FINALITY_BRANCH &&
    update.finalityBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isZeroedHeader(header: phase0.BeaconBlockHeader): boolean {
  // Fast return for when constructing full LightClientUpdate from partial updates
  return header === ZERO_HEADER || byteArrayEquals(header.bodyRoot, ZERO_HASH);
}

export function isZeroedSyncCommittee(syncCommittee: altair.SyncCommittee): boolean {
  // Fast return for when constructing full LightClientUpdate from partial updates
  return syncCommittee === ZERO_SYNC_COMMITTEE || byteArrayEquals(syncCommittee.pubkeys[0], ZERO_PUBKEY);
}

export function upgradeLightClientHeader(
  config: ChainForkConfig,
  targetFork: ForkName,
  header: altair.LightClientHeader
): allForks.LightClientHeader {
  const headerFork = config.getForkName(header.beacon.slot);
  if (ForkSeq[headerFork] >= ForkSeq[targetFork]) {
    throw Error(`Invalid upgrade request from headerFork=${headerFork} to targetFork=${targetFork}`);
  }

  // We are modifying the same header object, may be we could create a copy, but its
  // not required as of now
  const upgradedHeader = header as allForks.LightClientHeader;
  const startUpgradeFromFork = Object.values(ForkName)[ForkSeq[headerFork] + 1];

  switch (startUpgradeFromFork) {
    default:
      throw Error(
        `Invalid startUpgradeFromFork=${startUpgradeFromFork} for headerFork=${headerFork} in upgradeLightClientHeader to targetFork=${targetFork}`
      );

    // eslint-disable-next-line no-fallthrough
    case ForkName.altair:
    case ForkName.bellatrix:
      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.bellatrix) break;

    // eslint-disable-next-line no-fallthrough
    case ForkName.capella:
      (upgradedHeader as capella.LightClientHeader).execution =
        ssz.capella.LightClientHeader.fields.execution.defaultValue();
      (upgradedHeader as capella.LightClientHeader).executionBranch =
        ssz.capella.LightClientHeader.fields.executionBranch.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.capella) break;

    // eslint-disable-next-line no-fallthrough
    case ForkName.deneb:
      (upgradedHeader as deneb.LightClientHeader).execution.blobGasUsed =
        ssz.deneb.LightClientHeader.fields.execution.fields.blobGasUsed.defaultValue();
      (upgradedHeader as deneb.LightClientHeader).execution.excessBlobGas =
        ssz.deneb.LightClientHeader.fields.execution.fields.excessBlobGas.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.deneb) break;

    // eslint-disable-next-line no-fallthrough
    case ForkName.electra:
      (upgradedHeader as electra.LightClientHeader).execution.depositReceiptsRoot =
        ssz.electra.LightClientHeader.fields.execution.fields.depositReceiptsRoot.defaultValue();

      // Break if no further upgrades is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.electra) break;
  }
  return upgradedHeader;
}

export function isValidLightClientHeader(config: ChainForkConfig, header: allForks.LightClientHeader): boolean {
  const epoch = computeEpochAtSlot(header.beacon.slot);

  if (epoch < config.CAPELLA_FORK_EPOCH) {
    return (
      ((header as capella.LightClientHeader).execution === undefined ||
        ssz.capella.ExecutionPayloadHeader.equals(
          (header as capella.LightClientHeader).execution,
          ssz.capella.LightClientHeader.fields.execution.defaultValue()
        )) &&
      ((header as capella.LightClientHeader).executionBranch === undefined ||
        ssz.capella.LightClientHeader.fields.executionBranch.equals(
          ssz.capella.LightClientHeader.fields.executionBranch.defaultValue(),
          (header as capella.LightClientHeader).executionBranch
        ))
    );
  }

  if (epoch < config.DENEB_FORK_EPOCH) {
    if (
      ((header as deneb.LightClientHeader).execution.blobGasUsed &&
        (header as deneb.LightClientHeader).execution.blobGasUsed !== BigInt(0)) ||
      ((header as deneb.LightClientHeader).execution.excessBlobGas &&
        (header as deneb.LightClientHeader).execution.excessBlobGas !== BigInt(0))
    ) {
      return false;
    }
  }

  if (epoch < config.ELECTRA_FORK_EPOCH) {
    if ((header as electra.LightClientHeader).execution.depositReceiptsRoot !== undefined) {
      return false;
    }
  }

  return isValidMerkleBranch(
    config
      .getExecutionForkTypes(header.beacon.slot)
      .ExecutionPayloadHeader.hashTreeRoot((header as capella.LightClientHeader).execution),
    (header as capella.LightClientHeader).executionBranch,
    EXECUTION_PAYLOAD_DEPTH,
    EXECUTION_PAYLOAD_INDEX,
    header.beacon.bodyRoot
  );
}

export function upgradeLightClientUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  update: allForks.LightClientUpdate
): allForks.LightClientUpdate {
  update.attestedHeader = upgradeLightClientHeader(config, targetFork, update.attestedHeader);
  update.finalizedHeader = upgradeLightClientHeader(config, targetFork, update.finalizedHeader);

  return update;
}

export function upgradeLightClientFinalityUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  finalityUpdate: allForks.LightClientFinalityUpdate
): allForks.LightClientFinalityUpdate {
  finalityUpdate.attestedHeader = upgradeLightClientHeader(config, targetFork, finalityUpdate.attestedHeader);
  finalityUpdate.finalizedHeader = upgradeLightClientHeader(config, targetFork, finalityUpdate.finalizedHeader);

  return finalityUpdate;
}

export function upgradeLightClientOptimisticUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  optimisticUpdate: allForks.LightClientOptimisticUpdate
): allForks.LightClientOptimisticUpdate {
  optimisticUpdate.attestedHeader = upgradeLightClientHeader(config, targetFork, optimisticUpdate.attestedHeader);

  return optimisticUpdate;
}

/**
 * Currently this upgradation is not required because all processing is done based on the
 * summary that the store generates and maintains. In case store needs to be saved to disk,
 * this could be required depending on the format the store is saved to the disk
 */
export function upgradeLightClientStore(
  config: ChainForkConfig,
  targetFork: ForkName,
  store: LightClientStore,
  signatureSlot: Slot
): LightClientStore {
  const updateSignaturePeriod = computeSyncPeriodAtSlot(signatureSlot);
  const bestValidUpdate = store.bestValidUpdates.get(updateSignaturePeriod);

  if (bestValidUpdate) {
    store.bestValidUpdates.set(updateSignaturePeriod, {
      update: upgradeLightClientUpdate(config, targetFork, bestValidUpdate.update),
      summary: bestValidUpdate.summary,
    });
  }

  store.finalizedHeader = upgradeLightClientHeader(config, targetFork, store.finalizedHeader);
  store.optimisticHeader = upgradeLightClientHeader(config, targetFork, store.optimisticHeader);

  return store;
}
