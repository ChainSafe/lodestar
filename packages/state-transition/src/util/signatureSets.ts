import {PublicKey, Signature, aggregatePublicKeys, fastAggregateVerify, verify} from "@chainsafe/blst";
import {Root} from "@lodestar/types";
import {Index2PubkeyCache} from "../cache/pubkeyCache.js";

export enum SignatureSetType {
  single = "single",
  aggregate = "aggregate",
  /**
   * Single signature with validator index instead of pubkey.
   * Pubkey lookup is deferred to verification time.
   */
  indexed = "indexed",
}

/**
 * Single signature with pubkey directly.
 * Used when pubkey comes from the message itself (e.g. BLS to execution change).
 */
export type SingleSignatureSet = {
  type: SignatureSetType.single;
  pubkey: PublicKey;
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

export type ISignatureSet = SingleSignatureSet | IndexedSignatureSet | AggregatedSignatureSet;

/**
 * Get the pubkey for a signature set, performing aggregation if necessary.
 * Requires index2pubkey cache for indexed and aggregate sets.
 */
export function getSignatureSetPubkey(signatureSet: ISignatureSet, index2pubkey: Index2PubkeyCache): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.indexed:
      return index2pubkey[signatureSet.index];

    case SignatureSetType.aggregate: {
      const pubkeys = signatureSet.indices.map((i) => index2pubkey[i]);
      return aggregatePublicKeys(pubkeys);
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function verifySignatureSet(signatureSet: SingleSignatureSet, index2pubkey?: Index2PubkeyCache): boolean;
export function verifySignatureSet(signatureSet: IndexedSignatureSet, index2pubkey: Index2PubkeyCache): boolean;
export function verifySignatureSet(signatureSet: AggregatedSignatureSet, index2pubkey: Index2PubkeyCache): boolean;
export function verifySignatureSet(signatureSet: ISignatureSet, index2pubkey: Index2PubkeyCache): boolean;
export function verifySignatureSet(signatureSet: ISignatureSet, index2pubkey?: Index2PubkeyCache): boolean {
  // All signatures are not trusted and must be group checked (p2.subgroup_check)
  const signature = Signature.fromBytes(signatureSet.signature, true);

  switch (signatureSet.type) {
    case SignatureSetType.single:
      return verify(signatureSet.signingRoot, signatureSet.pubkey, signature);

    case SignatureSetType.indexed: {
      if (!index2pubkey) {
        throw Error("index2pubkey required for indexed signature set");
      }
      return verify(signatureSet.signingRoot, index2pubkey[signatureSet.index], signature);
    }

    case SignatureSetType.aggregate: {
      if (!index2pubkey) {
        throw Error("index2pubkey required for aggregate signature set");
      }
      const pubkeys = signatureSet.indices.map((i) => index2pubkey[i]);
      return fastAggregateVerify(signatureSet.signingRoot, pubkeys, signature);
    }

    default:
      throw Error("Unknown signature set type");
  }
}

export function createSingleSignatureSetFromComponents(
  pubkey: PublicKey,
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
