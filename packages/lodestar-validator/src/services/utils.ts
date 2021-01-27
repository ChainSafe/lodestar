import {SecretKey} from "@chainsafe/bls";
import {PublicKeyHex, ValidatorAndSecret} from "../types";

export function mapSecretKeysToValidators(secretKeys: SecretKey[]): Map<PublicKeyHex, ValidatorAndSecret> {
  const validators: Map<PublicKeyHex, ValidatorAndSecret> = new Map();
  for (const secretKey of secretKeys) {
    validators.set(secretKey.toPublicKey().toHex(), {validator: null, secretKey});
  }
  return validators;
}
