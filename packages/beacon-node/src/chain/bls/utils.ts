import type {PublicKey} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import blstTs from "blst-ts-test";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";

export function getAggregatedPubkeySync(signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      return bls.PublicKey.aggregate(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}

export async function getAggregatedPubkey(signatureSet: ISignatureSet): Promise<blstTs.PublicKey> {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return blstTs.PublicKey.deserialize(signatureSet.pubkey.toBytes());

    case SignatureSetType.aggregate:
      return blstTs.aggregatePublicKeys(signatureSet.pubkeys.map((pubkey) => pubkey.toBytes()));

    default:
      throw Error("Unknown signature set type");
  }
}

export function getAggregatedPubkeysCount(signatureSets: ISignatureSet[]): number {
  let pubkeysConut = 0;
  for (const set of signatureSets) {
    if (set.type === SignatureSetType.aggregate) {
      pubkeysConut += set.pubkeys.length;
    }
  }
  return pubkeysConut;
}
