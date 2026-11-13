import {BLS_VERIFIER_SET_TYPE, type BlsSignatureSet, verifySignatureSets} from "@lodestar/native/bls-verifier";
import {PublicKey, aggregatePublicKeys} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {Root} from "@lodestar/types";
import {PubkeyCacheState, getValidatorPubkey} from "../cache/pubkeyCache.js";

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

export type ISignatureSet = SingleSignatureSet | IndexedSignatureSet | AggregatedSignatureSet;

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

    default:
      throw Error("Unknown signature set type");
  }
}

/** Indexed slashings can include inactive validators outside the finalized cache. */
export function resolveSignatureSet(signatureSet: ISignatureSet, state: PubkeyCacheState): ISignatureSet {
  const size = pubkeyCache.size;
  if (signatureSet.type === SignatureSetType.indexed && signatureSet.index >= size) {
    return createSingleSignatureSetFromComponents(
      getValidatorPubkey(state, signatureSet.index, pubkeyCache),
      signatureSet.signingRoot,
      signatureSet.signature
    );
  }
  if (signatureSet.type === SignatureSetType.aggregate && signatureSet.indices.some((index) => index >= size)) {
    const finalizedIndices = [];
    const pubkeys = [];
    for (const index of signatureSet.indices) {
      if (index < size) {
        finalizedIndices.push(index);
      } else {
        pubkeys.push(PublicKey.fromBytes(getValidatorPubkey(state, index, pubkeyCache)));
      }
    }
    if (finalizedIndices.length > 0) {
      pubkeys.push(pubkeyCache.aggregate(finalizedIndices));
    }
    return createSingleSignatureSetFromComponents(
      aggregatePublicKeys(pubkeys).toBytes(),
      signatureSet.signingRoot,
      signatureSet.signature
    );
  }
  return signatureSet;
}

export function verifySignatureSet(signatureSet: ISignatureSet, state?: PubkeyCacheState): boolean {
  if (state !== undefined) {
    signatureSet = resolveSignatureSet(signatureSet, state);
  }
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
