import bls from "@chainsafe/bls/herumi";
import type {PublicKey} from "@chainsafe/bls/types";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {
  BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX,
  CURRENT_SYNC_COMMITTEE_GINDEX,
  CURRENT_SYNC_COMMITTEE_GINDEX_ELECTRA,
  CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS,
  EXECUTION_BLOCK_HASH_GINDEX,
  EXECUTION_BLOCK_HASH_GINDEX_DENEB,
  EXECUTION_BLOCK_HASH_GINDEX_GLOAS,
  FINALIZED_ROOT_GINDEX,
  FINALIZED_ROOT_GINDEX_ELECTRA,
  FINALIZED_ROOT_GINDEX_GLOAS,
  ForkName,
  ForkSeq,
  NEXT_SYNC_COMMITTEE_GINDEX,
  NEXT_SYNC_COMMITTEE_GINDEX_ELECTRA,
  NEXT_SYNC_COMMITTEE_GINDEX_GLOAS,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {
  BeaconBlockHeader,
  LightClientFinalityUpdate,
  LightClientHeader,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Slot,
  SyncCommittee,
  isElectraLightClientUpdate,
  ssz,
} from "@lodestar/types";
import {byteArrayEquals, verifyMerkleBranch} from "@lodestar/utils";
import {computeEpochAtSlot, computeSyncPeriodAtSlot} from "../../util/epoch.js";
import type {LightClientStore, SyncCommitteeFast} from "./store.js";

export const GENESIS_SLOT = 0;
export const ZERO_HASH = new Uint8Array(32);
export const ZERO_SYNC_COMMITTEE = ssz.altair.SyncCommittee.defaultValue();
export const ZERO_HEADER = ssz.phase0.BeaconBlockHeader.defaultValue();
/** From https://notes.ethereum.org/@vbuterin/extended_light_client_protocol#Optimistic-head-determining-function */
const SAFETY_THRESHOLD_FACTOR = 2;

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

/**
 * Util to guarantee that all bits have a corresponding pubkey.
 */
export function getParticipantPubkeys<T>(pubkeys: T[], bits: BitArray): T[] {
  // BitArray.intersectValues() checks the length is correct.
  return bits.intersectValues(pubkeys);
}

function deserializePubkeys(pubkeys: SyncCommittee["pubkeys"]): PublicKey[] {
  return pubkeys.map((pk) => bls.PublicKey.fromBytes(pk));
}

function serializePubkeys(pubkeys: PublicKey[]): SyncCommittee["pubkeys"] {
  return pubkeys.map((pk) => pk.toBytes());
}

export function deserializeSyncCommittee(syncCommittee: SyncCommittee): SyncCommitteeFast {
  return {
    pubkeys: deserializePubkeys(syncCommittee.pubkeys),
    aggregatePubkey: bls.PublicKey.fromBytes(syncCommittee.aggregatePubkey),
  };
}

export function serializeSyncCommittee(syncCommittee: SyncCommitteeFast): SyncCommittee {
  return {
    pubkeys: serializePubkeys(syncCommittee.pubkeys),
    aggregatePubkey: syncCommittee.aggregatePubkey.toBytes(),
  };
}

export function getSafetyThreshold(maxActiveParticipants: number): number {
  return Math.floor(maxActiveParticipants / SAFETY_THRESHOLD_FACTOR);
}

export function getZeroSyncCommitteeBranch(fork: ForkName): Uint8Array[] {
  return Array.from({length: getGindexDepth(nextSyncCommitteeGindexAtFork(fork))}, () => ZERO_HASH);
}

export function getZeroFinalityBranch(fork: ForkName): Uint8Array[] {
  return Array.from({length: getGindexDepth(finalizedRootGindexAtFork(fork))}, () => ZERO_HASH);
}

export function isSyncCommitteeUpdate(update: LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.nextSyncCommitteeBranch !==
      getZeroSyncCommitteeBranch(isElectraLightClientUpdate(update) ? ForkName.electra : ForkName.altair) &&
    update.nextSyncCommitteeBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isFinalityUpdate(update: LightClientUpdate): boolean {
  return (
    // Fast return for when constructing full LightClientUpdate from partial updates
    update.finalityBranch !==
      getZeroFinalityBranch(isElectraLightClientUpdate(update) ? ForkName.electra : ForkName.altair) &&
    update.finalityBranch.some((branch) => !byteArrayEquals(branch, ZERO_HASH))
  );
}

export function isZeroedHeader(header: BeaconBlockHeader): boolean {
  // Spec requires the whole header to equal LightClientHeader() in the non-finality case
  // (see altair/light-client/sync-protocol.md `process_light_client_update`). Checking only
  // bodyRoot would let an attacker smuggle arbitrary slot/proposerIndex/parentRoot/stateRoot
  // through the non-finality branch and overwrite store.finalizedHeader.
  return header === ZERO_HEADER || ssz.phase0.BeaconBlockHeader.equals(header, ZERO_HEADER);
}

export function isZeroedSyncCommittee(syncCommittee: SyncCommittee): boolean {
  // Spec requires the whole SyncCommittee to equal SyncCommittee() in the non-sync-committee-update case.
  return syncCommittee === ZERO_SYNC_COMMITTEE || ssz.altair.SyncCommittee.equals(syncCommittee, ZERO_SYNC_COMMITTEE);
}

export function isValidMerkleBranch(
  leaf: Uint8Array,
  branch: Uint8Array[],
  depth: number,
  index: number,
  root: Uint8Array
): boolean {
  if (branch.length !== depth) {
    return false;
  }

  return verifyMerkleBranch(leaf, branch, depth, index, root);
}

export function isValidNormalizedMerkleBranch(
  leaf: Uint8Array,
  branch: Uint8Array[],
  gindex: number,
  root: Uint8Array
): boolean {
  const depth = getGindexDepth(gindex);
  const index = getGindexIndex(gindex);
  const numExtraDepth = branch.length - depth;
  if (numExtraDepth < 0) {
    return false;
  }

  for (let i = 0; i < numExtraDepth; i++) {
    if (!byteArrayEquals(branch[i], ZERO_HASH)) {
      return false;
    }
  }

  return isValidMerkleBranch(leaf, branch.slice(numExtraDepth), depth, index, root);
}

export function normalizeMerkleBranch(branch: Uint8Array[], gindex: number): Uint8Array[] {
  const depth = getGindexDepth(gindex);
  const numExtraDepth = depth - branch.length;

  return [...Array.from({length: numExtraDepth}, () => ZERO_HASH), ...branch];
}

export function currentSyncCommitteeGindexAtFork(fork: ForkName): number {
  if (isForkPostGloas(fork)) {
    return CURRENT_SYNC_COMMITTEE_GINDEX_GLOAS;
  }
  if (isForkPostElectra(fork)) {
    return CURRENT_SYNC_COMMITTEE_GINDEX_ELECTRA;
  }
  return CURRENT_SYNC_COMMITTEE_GINDEX;
}

export function finalizedRootGindexAtFork(fork: ForkName): number {
  if (isForkPostGloas(fork)) {
    return FINALIZED_ROOT_GINDEX_GLOAS;
  }
  if (isForkPostElectra(fork)) {
    return FINALIZED_ROOT_GINDEX_ELECTRA;
  }
  return FINALIZED_ROOT_GINDEX;
}

export function nextSyncCommitteeGindexAtFork(fork: ForkName): number {
  if (isForkPostGloas(fork)) {
    return NEXT_SYNC_COMMITTEE_GINDEX_GLOAS;
  }
  if (isForkPostElectra(fork)) {
    return NEXT_SYNC_COMMITTEE_GINDEX_ELECTRA;
  }
  return NEXT_SYNC_COMMITTEE_GINDEX;
}

function getGindexDepth(gindex: number): number {
  return Math.floor(Math.log2(gindex));
}

function getGindexIndex(gindex: number): number {
  return gindex - 2 ** getGindexDepth(gindex);
}

export function upgradeLightClientHeader(
  config: ChainForkConfig,
  targetFork: ForkName,
  header: LightClientHeader
): LightClientHeader {
  const headerFork = config.getForkName(header.beacon.slot);
  if (ForkSeq[headerFork] >= ForkSeq[targetFork]) {
    throw Error(`Invalid upgrade request from headerFork=${headerFork} to targetFork=${targetFork}`);
  }

  // We are modifying the same header object, may be we could create a copy, but its
  // not required as of now
  let upgradedHeader = header;
  const startUpgradeFromFork = Object.values(ForkName)[ForkSeq[headerFork] + 1];

  switch (startUpgradeFromFork) {
    // biome-ignore lint/suspicious/useDefaultSwitchClauseLast: We want default to evaluate at first to throw error early
    default:
      throw Error(
        `Invalid startUpgradeFromFork=${startUpgradeFromFork} for headerFork=${headerFork} in upgradeLightClientHeader to targetFork=${targetFork}`
      );

    case ForkName.altair:
    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.bellatrix:
      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.bellatrix) break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.capella:
      (upgradedHeader as LightClientHeader<ForkName.capella>).execution =
        ssz.capella.LightClientHeader.fields.execution.defaultValue();
      (upgradedHeader as LightClientHeader<ForkName.capella>).executionBranch =
        ssz.capella.LightClientHeader.fields.executionBranch.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.capella) break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.deneb:
      (upgradedHeader as LightClientHeader<ForkName.deneb>).execution.blobGasUsed =
        ssz.deneb.LightClientHeader.fields.execution.fields.blobGasUsed.defaultValue();
      (upgradedHeader as LightClientHeader<ForkName.deneb>).execution.excessBlobGas =
        ssz.deneb.LightClientHeader.fields.execution.fields.excessBlobGas.defaultValue();

      // Break if no further upgradation is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.deneb) break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.electra:
      // No changes to LightClientHeader in Electra

      // Break if no further upgrades is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.electra) break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.fulu:
      // No changes to LightClientHeader in Fulu

      // Break if no further upgrades is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.fulu) break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
    case ForkName.gloas:
      if (isGloasLightClientHeader(upgradedHeader)) {
        break;
      }

      upgradedHeader = upgradeLightClientHeaderToGloas(config, upgradedHeader as LightClientHeader<ForkName.electra>);

      // Break if no further upgrades is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.gloas) break;

    case ForkName.heze:
      // No changes to LightClientHeader in Heze

      // Break if no further upgrades is required else fall through
      if (ForkSeq[targetFork] <= ForkSeq.heze) break;
  }
  return upgradedHeader;
}

export function isValidLightClientHeader(config: ChainForkConfig, header: LightClientHeader): boolean {
  const epoch = computeEpochAtSlot(header.beacon.slot);

  if (isGloasLightClientHeader(header)) {
    if (epoch >= config.GLOAS_FORK_EPOCH) {
      return isValidNormalizedMerkleBranch(
        header.executionBlockHash,
        header.executionBranch,
        EXECUTION_BLOCK_HASH_GINDEX_GLOAS,
        header.beacon.bodyRoot
      );
    }

    if (epoch >= config.DENEB_FORK_EPOCH) {
      return isValidNormalizedMerkleBranch(
        header.executionBlockHash,
        header.executionBranch,
        EXECUTION_BLOCK_HASH_GINDEX_DENEB,
        header.beacon.bodyRoot
      );
    }

    if (epoch >= config.CAPELLA_FORK_EPOCH) {
      return isValidNormalizedMerkleBranch(
        header.executionBlockHash,
        header.executionBranch,
        EXECUTION_BLOCK_HASH_GINDEX,
        header.beacon.bodyRoot
      );
    }

    return (
      byteArrayEquals(header.executionBlockHash, ZERO_HASH) &&
      header.executionBranch.every((node) => byteArrayEquals(node, ZERO_HASH))
    );
  }

  if (epoch < config.CAPELLA_FORK_EPOCH) {
    return (
      ((header as LightClientHeader<ForkName.capella>).execution === undefined ||
        ssz.capella.ExecutionPayloadHeader.equals(
          (header as LightClientHeader<ForkName.capella>).execution,
          ssz.capella.LightClientHeader.fields.execution.defaultValue()
        )) &&
      ((header as LightClientHeader<ForkName.capella>).executionBranch === undefined ||
        ssz.capella.LightClientHeader.fields.executionBranch.equals(
          ssz.capella.LightClientHeader.fields.executionBranch.defaultValue(),
          (header as LightClientHeader<ForkName.capella>).executionBranch
        ))
    );
  }

  if (
    epoch < config.DENEB_FORK_EPOCH &&
    (((header as LightClientHeader<ForkName.deneb>).execution.blobGasUsed &&
      (header as LightClientHeader<ForkName.deneb>).execution.blobGasUsed !== BigInt(0)) ||
      ((header as LightClientHeader<ForkName.deneb>).execution.excessBlobGas &&
        (header as LightClientHeader<ForkName.deneb>).execution.excessBlobGas !== BigInt(0)))
  ) {
    return false;
  }

  return isValidMerkleBranch(
    config
      .getPostBellatrixForkTypes(header.beacon.slot)
      .ExecutionPayloadHeader.hashTreeRoot((header as LightClientHeader<ForkName.capella>).execution),
    (header as LightClientHeader<ForkName.capella>).executionBranch,
    getGindexDepth(BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX),
    getGindexIndex(BLOCK_BODY_EXECUTION_PAYLOAD_GINDEX),
    header.beacon.bodyRoot
  );
}

export function upgradeLightClientUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  update: LightClientUpdate
): LightClientUpdate {
  update.attestedHeader = upgradeLightClientHeader(config, targetFork, update.attestedHeader);
  update.finalizedHeader = upgradeLightClientHeader(config, targetFork, update.finalizedHeader);
  update.nextSyncCommitteeBranch = normalizeMerkleBranch(
    update.nextSyncCommitteeBranch,
    nextSyncCommitteeGindexAtFork(targetFork)
  );
  update.finalityBranch = normalizeMerkleBranch(update.finalityBranch, finalizedRootGindexAtFork(targetFork));

  return update;
}

export function upgradeLightClientFinalityUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  finalityUpdate: LightClientFinalityUpdate
): LightClientFinalityUpdate {
  finalityUpdate.attestedHeader = upgradeLightClientHeader(config, targetFork, finalityUpdate.attestedHeader);
  finalityUpdate.finalizedHeader = upgradeLightClientHeader(config, targetFork, finalityUpdate.finalizedHeader);
  finalityUpdate.finalityBranch = normalizeMerkleBranch(
    finalityUpdate.finalityBranch,
    finalizedRootGindexAtFork(targetFork)
  );

  return finalityUpdate;
}

export function upgradeLightClientOptimisticUpdate(
  config: ChainForkConfig,
  targetFork: ForkName,
  optimisticUpdate: LightClientOptimisticUpdate
): LightClientOptimisticUpdate {
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

function isGloasLightClientHeader(header: LightClientHeader): header is LightClientHeader<ForkName.gloas> {
  return (header as LightClientHeader<ForkName.gloas>).executionBlockHash !== undefined;
}

function upgradeLightClientHeaderToGloas(
  config: ChainForkConfig,
  pre: LightClientHeader<ForkName.electra>
): LightClientHeader<ForkName.gloas> {
  if (ssz.electra.LightClientHeader.equals(pre, ssz.electra.LightClientHeader.defaultValue())) {
    return ssz.gloas.LightClientHeader.defaultValue();
  }

  const epoch = computeEpochAtSlot(pre.beacon.slot);

  if (epoch >= config.DENEB_FORK_EPOCH) {
    const blockHashGindex = ssz.deneb.ExecutionPayloadHeader.getPathInfo(["blockHash"]).gindex;
    const executionBranch = new Tree(ssz.deneb.ExecutionPayloadHeader.toView(pre.execution).node).getSingleProof(
      blockHashGindex
    );

    return {
      beacon: pre.beacon,
      executionBlockHash: pre.execution.blockHash,
      executionBranch: normalizeMerkleBranch(
        [...executionBranch, ...pre.executionBranch],
        EXECUTION_BLOCK_HASH_GINDEX_GLOAS
      ),
    };
  }

  if (epoch >= config.CAPELLA_FORK_EPOCH) {
    const executionHeader = {
      parentHash: pre.execution.parentHash,
      feeRecipient: pre.execution.feeRecipient,
      stateRoot: pre.execution.stateRoot,
      receiptsRoot: pre.execution.receiptsRoot,
      logsBloom: pre.execution.logsBloom,
      prevRandao: pre.execution.prevRandao,
      blockNumber: pre.execution.blockNumber,
      gasLimit: pre.execution.gasLimit,
      gasUsed: pre.execution.gasUsed,
      timestamp: pre.execution.timestamp,
      extraData: pre.execution.extraData,
      baseFeePerGas: pre.execution.baseFeePerGas,
      blockHash: pre.execution.blockHash,
      transactionsRoot: pre.execution.transactionsRoot,
      withdrawalsRoot: pre.execution.withdrawalsRoot,
    };
    const blockHashGindex = ssz.capella.ExecutionPayloadHeader.getPathInfo(["blockHash"]).gindex;
    const executionBranch = new Tree(ssz.capella.ExecutionPayloadHeader.toView(executionHeader).node).getSingleProof(
      blockHashGindex
    );

    return {
      beacon: pre.beacon,
      executionBlockHash: executionHeader.blockHash,
      executionBranch: normalizeMerkleBranch(
        [...executionBranch, ...pre.executionBranch],
        EXECUTION_BLOCK_HASH_GINDEX_GLOAS
      ),
    };
  }

  return {
    ...ssz.gloas.LightClientHeader.defaultValue(),
    beacon: pre.beacon,
  };
}
