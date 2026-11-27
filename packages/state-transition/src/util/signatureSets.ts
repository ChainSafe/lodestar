import {BitArray} from "@chainsafe/ssz";
import {BLS_VERIFIER_SET_TYPE, type BlsSignatureSet, verifySignatureSets} from "@lodestar/native/bls-verifier";
import {Root, Slot} from "@lodestar/types";

export enum SignatureSetType {
  single = "single",
  aggregate = "aggregate",
  /**
   * Single signature with validator index instead of pubkey.
   * Pubkey lookup is deferred to verification time.
   */
  indexed = "indexed",
  /**
   * Aggregate signature of an attestation over whole committees of one slot.
   * Pubkeys come from the committee aggregates of the shuffling, see `computeCommitteePubkeys()`.
   */
  committee = "committee",
}

/**
 * Single signature with pubkey directly.
 * Used when pubkey comes from the message itself (e.g. BLS to execution change).
 */
export type SingleSignatureSet = {
  type: SignatureSetType.single;
  pubkey: Uint8Array;
  signingRoot: Root;
  signature: Uint8Array;
};

/**
 * Single signature with validator index.
 * Pubkey is looked up at verification time.
 */
export type IndexedSignatureSet = {
  type: SignatureSetType.indexed;
  index: number;
  signingRoot: Root;
  signature: Uint8Array;
};

/**
 * Aggregate signature with validator indices.
 * Pubkeys are looked up and aggregated at verification time.
 */
export type AggregatedSignatureSet = {
  type: SignatureSetType.aggregate;
  indices: number[];
  signingRoot: Root;
  signature: Uint8Array;
};

/**
 * Aggregate signature of an attestation over the committees `committeeIndices` of `slot`.
 * `indices` lists the participants, aggregated instead when the committee pubkeys are not cached.
 */
export type CommitteeSignatureSet = {
  type: SignatureSetType.committee;
  indices: number[];
  committeePubkeysId: number;
  slot: Slot;
  committeeIndices: number[];
  aggregationBits: BitArray;
  signingRoot: Root;
  signature: Uint8Array;
};

export type ISignatureSet = SingleSignatureSet | IndexedSignatureSet | AggregatedSignatureSet | CommitteeSignatureSet;

export function toBlsSignatureSet(signatureSet: ISignatureSet): BlsSignatureSet {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return {
        type: BLS_VERIFIER_SET_TYPE.single,
        pubkey: signatureSet.pubkey,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };

    case SignatureSetType.indexed:
      return {
        type: BLS_VERIFIER_SET_TYPE.indexed,
        index: signatureSet.index,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };

    case SignatureSetType.aggregate: {
      const indices = new Uint32Array(signatureSet.indices.length);
      for (const [i, index] of signatureSet.indices.entries()) {
        if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
          throw new RangeError(`Invalid validator index ${index}`);
        }
        indices[i] = index;
      }

      return {
        type: BLS_VERIFIER_SET_TYPE.aggregate,
        indices,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };
    }

    case SignatureSetType.committee: {
      const indices = new Uint32Array(signatureSet.indices.length);
      for (const [i, index] of signatureSet.indices.entries()) {
        if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) {
          throw new RangeError(`Invalid validator index ${index}`);
        }
        indices[i] = index;
      }

      return {
        type: BLS_VERIFIER_SET_TYPE.committee,
        indices,
        committeePubkeysId: signatureSet.committeePubkeysId,
        slot: signatureSet.slot,
        committeeIndices: Uint32Array.from(signatureSet.committeeIndices),
        aggregationBits: signatureSet.aggregationBits.uint8Array,
        bitLen: signatureSet.aggregationBits.bitLen,
        message: signatureSet.signingRoot,
        signature: signatureSet.signature,
      };
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function verifySignatureSet(signatureSet: ISignatureSet): boolean {
  return verifySignatureSets([toBlsSignatureSet(signatureSet)]);
}

export function createSingleSignatureSetFromComponents(
  pubkey: Uint8Array,
  signingRoot: Root,
  signature: Uint8Array
): SingleSignatureSet {
  return {
    type: SignatureSetType.single,
    pubkey,
    signingRoot,
    signature,
  };
}

export function createIndexedSignatureSetFromComponents(
  index: number,
  signingRoot: Root,
  signature: Uint8Array
): IndexedSignatureSet {
  return {
    type: SignatureSetType.indexed,
    index,
    signingRoot,
    signature,
  };
}

export function createAggregateSignatureSetFromComponents(
  indices: number[],
  signingRoot: Root,
  signature: Uint8Array
): AggregatedSignatureSet {
  return {
    type: SignatureSetType.aggregate,
    indices,
    signingRoot,
    signature,
  };
}
