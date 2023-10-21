import {CompositeViewDU, ValueOf} from "@chainsafe/ssz";
import {deserializeContainerIgnoreFields, ssz} from "@lodestar/types";

/**
 * Load validator from bytes given a seed validator.
 * - If it's the same validator, reuse pubkey and withdrawal credentials to save memory
 * - If it's a new validator, deserialize it
 */
export function loadValidator(
  seedValidator: CompositeViewDU<typeof ssz.phase0.Validator>,
  newValidatorBytes: Uint8Array
): CompositeViewDU<typeof ssz.phase0.Validator> {
  if (isSameValidator(seedValidator, newValidatorBytes)) {
    const newValidatorValue = deserializeContainerIgnoreFields(ssz.phase0.Validator, newValidatorBytes, [
      "pubkey",
      "withdrawalCredentials",
    ]);
    const seedValidatorValue = (seedValidator.node as unknown as {value: ValueOf<typeof ssz.phase0.Validator>}).value;
    newValidatorValue.pubkey = seedValidatorValue.pubkey;
    newValidatorValue.withdrawalCredentials = seedValidatorValue.withdrawalCredentials;
    return ssz.phase0.Validator.toViewDU(newValidatorValue);
  } else {
    return ssz.phase0.Validator.deserializeToViewDU(newValidatorBytes);
  }
}

/**
 * Return true if both validators have the same pubkey and withdrawal credentials
 */
function isSameValidator(validator: CompositeViewDU<typeof ssz.phase0.Validator>, validatorBytes: Uint8Array): boolean {
  const pubkey = validatorBytes.subarray(0, 48);
  if (Buffer.compare(pubkey, validator.pubkey) !== 0) {
    return false;
  }

  const withdrawalCredentials = validatorBytes.subarray(48, 80);
  if (Buffer.compare(withdrawalCredentials, validator.withdrawalCredentials) !== 0) {
    return false;
  }

  return true;
}
