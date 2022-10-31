// TODO architect later, right now just copied from light-client module
import {hash} from "@chainsafe/persistent-merkle-tree";
import {BitArray, byteArrayEquals} from "@chainsafe/ssz";
import {IBeaconConfig, IChainConfig} from "@lodestar/config";
import {altair, Epoch, Root, Slot, ssz, SyncPeriod} from "@lodestar/types";
import {
  DOMAIN_SYNC_COMMITTEE,
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  FINALIZED_ROOT_DEPTH,
  FINALIZED_ROOT_INDEX,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  NEXT_SYNC_COMMITTEE_DEPTH,
  NEXT_SYNC_COMMITTEE_INDEX,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {PublicKey, Signature} from "@chainsafe/bls/types";
import {BeaconBlockHeader} from "@lodestar/types/phase0";
import bls from "@chainsafe/bls/switchable";

export const isNode =
  Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]";

export function isValidMerkleBranch(
  leaf: Uint8Array,
  proof: Uint8Array[],
  depth: number,
  index: number,
  root: Uint8Array
): boolean {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (Math.floor(index / 2 ** i) % 2) {
      value = hash(proof[i], value);
    } else {
      value = hash(value, proof[i]);
    }
  }
  return byteArrayEquals(value, root);
}

export function getCurrentSlot(config: IChainConfig, genesisTime: number): Slot {
  const diffInSeconds = Date.now() / 1000 - genesisTime;
  return Math.floor(diffInSeconds / config.SECONDS_PER_SLOT);
}

/**
 * Return the sync committee period at slot
 */
export function computeSyncPeriodAtSlot(slot: Slot): SyncPeriod {
  return computeSyncPeriodAtEpoch(computeEpochAtSlot(slot));
}

/**
 * Return the sync committee period at epoch
 */
export function computeSyncPeriodAtEpoch(epoch: Epoch): SyncPeriod {
  return Math.floor(epoch / EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
}

export function computeEpochAtSlot(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
}

export type SyncCommitteeFast = {
  pubkeys: PublicKey[];
  aggregatePubkey: PublicKey;
};

export function timeUntilNextEpoch(config: Pick<IChainConfig, "SECONDS_PER_SLOT">, genesisTime: number): number {
  const miliSecondsPerEpoch = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - genesisTime * 1000;
  if (msFromGenesis >= 0) {
    return miliSecondsPerEpoch - (msFromGenesis % miliSecondsPerEpoch);
  } else {
    return Math.abs(msFromGenesis % miliSecondsPerEpoch);
  }
}

export type LightclientUpdateStats = {
  isFinalized: boolean;
  participation: number;
  slot: Slot;
};

/** Returns the slot if the internal clock were advanced by `toleranceSec`. */
export function slotWithFutureTolerance(config: IChainConfig, genesisTime: number, toleranceSec: number): Slot {
  // this is the same to getting slot at now + toleranceSec
  return getCurrentSlot(config, genesisTime - toleranceSec);
}

export function isEmptyHeader(header: BeaconBlockHeader): boolean {
  const emptyValue = ssz.phase0.BeaconBlockHeader.defaultValue();
  return ssz.phase0.BeaconBlockHeader.equals(emptyValue, header);
}

export function assertValidFinalityProof(update: altair.LightClientFinalityUpdate): void {
  if (
    !isValidMerkleBranch(
      ssz.phase0.BeaconBlockHeader.hashTreeRoot(update.finalizedHeader),
      update.finalityBranch,
      FINALIZED_ROOT_DEPTH,
      FINALIZED_ROOT_INDEX,
      update.attestedHeader.stateRoot
    )
  ) {
    throw Error("Invalid finality header merkle branch");
  }

  const updatePeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
  const updateFinalityPeriod = computeSyncPeriodAtSlot(update.finalizedHeader.slot);
  if (updateFinalityPeriod !== updatePeriod) {
    throw Error(`finalityHeader period ${updateFinalityPeriod} != header period ${updatePeriod}`);
  }
}

export function assertValidSyncCommitteeProof(update: altair.LightClientUpdate): void {
  if (
    !isValidMerkleBranch(
      ssz.altair.SyncCommittee.hashTreeRoot(update.nextSyncCommittee),
      update.nextSyncCommitteeBranch,
      NEXT_SYNC_COMMITTEE_DEPTH,
      NEXT_SYNC_COMMITTEE_INDEX,
      update.attestedHeader.stateRoot
    )
  ) {
    throw Error("Invalid next sync committee merkle branch");
  }
}

function isValidBlsAggregate(publicKeys: PublicKey[], message: Uint8Array, signature: Uint8Array): boolean {
  let aggPubkey: PublicKey;
  try {
    aggPubkey = bls.PublicKey.aggregate(publicKeys);
  } catch (e) {
    (e as Error).message = `Error aggregating pubkeys: ${(e as Error).message}`;
    throw e;
  }

  let sig: Signature;
  try {
    sig = bls.Signature.fromBytes(signature, undefined, true);
  } catch (e) {
    (e as Error).message = `Error deserializing signature: ${(e as Error).message}`;
    throw e;
  }

  try {
    return sig.verify(aggPubkey, message);
  } catch (e) {
    (e as Error).message = `Error verifying signature: ${(e as Error).message}`;
    throw e;
  }
}

export function assertValidSignedHeader(
  config: IBeaconConfig,
  syncCommittee: SyncCommitteeFast,
  syncAggregate: altair.SyncAggregate,
  signedHeaderRoot: Root,
  signedHeaderSlot: Slot
): void {
  const participantPubkeys = getParticipantPubkeys(syncCommittee.pubkeys, syncAggregate.syncCommitteeBits);

  // Verify sync committee has sufficient participants.
  // SyncAggregates included in blocks may have zero participants
  if (participantPubkeys.length < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
    throw Error("Sync committee has not sufficient participants");
  }

  const signingRoot = ssz.phase0.SigningData.hashTreeRoot({
    objectRoot: signedHeaderRoot,
    domain: config.getDomain(signedHeaderSlot, DOMAIN_SYNC_COMMITTEE),
  });

  if (!isValidBlsAggregate(participantPubkeys, signingRoot, syncAggregate.syncCommitteeSignature)) {
    throw Error("Invalid aggregate signature");
  }
}

export function assertValidLightClientUpdate(
  config: IBeaconConfig,
  syncCommittee: SyncCommitteeFast,
  update: altair.LightClientUpdate
): void {
  // DIFF FROM SPEC: An update with the same header.slot can be valid and valuable to the lightclient
  // It may have more consensus and result in a better snapshot whilst not advancing the state
  // ----
  // Verify update slot is larger than snapshot slot
  // if (update.header.slot <= snapshot.header.slot) {
  //   throw Error("update slot is less or equal snapshot slot");
  // }

  // Verify update header root is the finalized root of the finality header, if specified
  const isFinalized = !isEmptyHeader(update.finalizedHeader);
  if (isFinalized) {
    assertValidFinalityProof(update);
  } else {
    assertZeroHashes(update.finalityBranch, FINALIZED_ROOT_DEPTH, "finalityBranches");
  }

  // DIFF FROM SPEC:
  // The nextSyncCommitteeBranch should be check always not only when updatePeriodIncremented
  // An update may not increase the period but still be stored in validUpdates and be used latter
  assertValidSyncCommitteeProof(update);

  const {attestedHeader} = update;
  const headerBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(attestedHeader);
  assertValidSignedHeader(config, syncCommittee, update.syncAggregate, headerBlockRoot, attestedHeader.slot);
}

export function assertZeroHashes(rootArray: Root[], expectedLength: number, errorMessage: string): void {
  if (rootArray.length !== expectedLength) {
    throw Error(`Wrong length ${errorMessage}`);
  }

  for (const root of rootArray) {
    if (!isZeroHash(root)) {
      throw Error(`Not zeroed ${errorMessage}`);
    }
  }
}

export function isZeroHash(root: Root): boolean {
  for (let i = 0; i < root.length; i++) {
    if (root[i] !== 0) {
      return false;
    }
  }
  return true;
}

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

export function isBetterUpdate(prev: LightclientUpdateStats, next: LightclientUpdateStats): boolean {
  // Finalized if participation is over 66%
  if (!prev.isFinalized && next.isFinalized && next.participation * 3 > SYNC_COMMITTEE_SIZE * 2) {
    return true;
  }

  // Higher bit count
  if (prev.participation > next.participation) return false;
  if (prev.participation < next.participation) return true;

  // else keep the oldest, lowest chance or re-org and requires less updating
  return prev.slot > next.slot;
}

function deserializePubkeys(pubkeys: altair.LightClientUpdate["nextSyncCommittee"]["pubkeys"]): PublicKey[] {
  return Array.from(pubkeys).map((pk) => bls.PublicKey.fromBytes(pk));
}

export function deserializeSyncCommittee(syncCommittee: altair.SyncCommittee): SyncCommitteeFast {
  return {
    pubkeys: deserializePubkeys(syncCommittee.pubkeys),
    aggregatePubkey: bls.PublicKey.fromBytes(syncCommittee.aggregatePubkey),
  };
}

export function getParticipantPubkeys<T>(pubkeys: T[], bits: BitArray): T[] {
  // BitArray.intersectValues() checks the length is correct
  return bits.intersectValues(pubkeys);
}
