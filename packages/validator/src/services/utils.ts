import {SecretKey} from "@chainsafe/bls";
import {PublicKeyHex, ValidatorAndSecret} from "../types";

export function mapSecretKeysToValidators(secretKeys: SecretKey[]): Map<PublicKeyHex, ValidatorAndSecret> {
  const validators: Map<PublicKeyHex, ValidatorAndSecret> = new Map<PublicKeyHex, ValidatorAndSecret>();
  for (const secretKey of secretKeys) {
    validators.set(secretKey.toPublicKey().toHex(), {validator: null, secretKey});
  }
  return validators;
}

export function getAggregationBits(committeeLength: number, validatorIndexInCommittee: number): boolean[] {
  return Array.from({length: committeeLength}, (_, i) => i === validatorIndexInCommittee);
}
