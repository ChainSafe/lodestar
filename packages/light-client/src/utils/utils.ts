import {PublicKey} from "@chainsafe/bls";
import {altair, Root, ssz} from "@chainsafe/lodestar-types";
import {BeaconBlockHeader} from "@chainsafe/lodestar-types/phase0";
import {BitArray} from "@chainsafe/ssz";
import {SyncCommitteeFast} from "../types";

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

export function isZeroHash(root: Root): boolean {
  for (let i = 0; i < root.length; i++) {
    if (root[i] !== 0) {
      return false;
    }
  }
  return true;
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

/**
 * Util to guarantee that all bits have a corresponding pubkey
 */
export function getParticipantPubkeys<T>(pubkeys: T[], bits: BitArray): T[] {
  // BitArray.intersectValues() checks the length is correct
  return bits.intersectValues(pubkeys);
}

export function toBlockHeader(block: altair.BeaconBlock): BeaconBlockHeader {
  return {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    bodyRoot: ssz.altair.BeaconBlockBody.hashTreeRoot(block.body),
  };
}

function deserializePubkeys(pubkeys: altair.LightClientUpdate["nextSyncCommittee"]["pubkeys"]): PublicKey[] {
  return Array.from(pubkeys).map((pk) => PublicKey.fromBytes(pk));
}

function serializePubkeys(pubkeys: PublicKey[]): altair.LightClientUpdate["nextSyncCommittee"]["pubkeys"] {
  return pubkeys.map((pk) => pk.toBytes());
}

export function deserializeSyncCommittee(syncCommittee: altair.SyncCommittee): SyncCommitteeFast {
  return {
    pubkeys: deserializePubkeys(syncCommittee.pubkeys),
    aggregatePubkey: PublicKey.fromBytes(syncCommittee.aggregatePubkey),
  };
}

export function serializeSyncCommittee(syncCommittee: SyncCommitteeFast): altair.SyncCommittee {
  return {
    pubkeys: serializePubkeys(syncCommittee.pubkeys),
    aggregatePubkey: syncCommittee.aggregatePubkey.toBytes(),
  };
}

export function isEmptyHeader(header: BeaconBlockHeader): boolean {
  const emptyValue = ssz.phase0.BeaconBlockHeader.defaultValue();
  return ssz.phase0.BeaconBlockHeader.equals(emptyValue, header);
}
