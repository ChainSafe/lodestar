import {SecretKey} from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex, BLSKeypair} from "../types";

export function mapSecretKeysToValidators(secretKeys: SecretKey[]): Map<PubkeyHex, BLSKeypair> {
  const validators: Map<PubkeyHex, BLSKeypair> = new Map<PubkeyHex, BLSKeypair>();
  for (const secretKey of secretKeys) {
    const publicKey = secretKey.toPublicKey().toBytes();
    validators.set(toHexString(publicKey), {publicKey, secretKey});
  }
  return validators;
}

export function getAggregationBits(committeeLength: number, validatorIndexInCommittee: number): boolean[] {
  return Array.from({length: committeeLength}, (_, i) => i === validatorIndexInCommittee);
}
