import {CompositeViewDU} from "@chainsafe/ssz";
import {deserializeContainerIgnoreFields, ssz} from "@lodestar/types";

/**
 * Load validator from bytes given a seed validator.
 * - Reuse pubkey and withdrawal credentials if possible to save memory
 * - If it's a new validator, deserialize it
 */
export function loadValidator(
  seedValidator: CompositeViewDU<typeof ssz.phase0.Validator>,
  newValidatorBytes: Uint8Array
): CompositeViewDU<typeof ssz.phase0.Validator> {
  const ignoredFields = getSameFields(seedValidator, newValidatorBytes);
  if (ignoredFields.length > 0) {
    const newValidatorValue = deserializeContainerIgnoreFields(ssz.phase0.Validator, newValidatorBytes, ignoredFields);
    for (const field of ignoredFields) {
      newValidatorValue[field] = seedValidator[field];
    }
    return ssz.phase0.Validator.toViewDU(newValidatorValue);
  }
  return ssz.phase0.Validator.deserializeToViewDU(newValidatorBytes);
}

/**
 * Return pubkey or withdrawalCredentials or both if they are the same.
 */
function getSameFields(
  validator: CompositeViewDU<typeof ssz.phase0.Validator>,
  validatorBytes: Uint8Array
): ("pubkey" | "withdrawalCredentials")[] {
  const ignoredFields: ("pubkey" | "withdrawalCredentials")[] = [];
  const pubkey = validatorBytes.subarray(0, 48);
  if (Buffer.compare(pubkey, validator.pubkey) === 0) {
    ignoredFields.push("pubkey");
  }

  const withdrawalCredentials = validatorBytes.subarray(48, 80);
  if (Buffer.compare(withdrawalCredentials, validator.withdrawalCredentials) === 0) {
    ignoredFields.push("withdrawalCredentials");
  }

  return ignoredFields;
}
