import {CompositeViewDU} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ValidatorIndex, deserializeContainerIgnoreFields, ssz} from "@lodestar/types";
import {getStateTypeFromBytes} from "../sszBytes.js";

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

/**
 * Extract and deserialize validator effective balances from state bytes
 */
export function getEffectiveBalancesFromStateBytes(
  config: ChainForkConfig,
  stateBytes: Uint8Array,
  validatorIndices: ValidatorIndex[]
): number[] {
  // stateType could be any types, casting just to make typescript happy
  const stateType = getStateTypeFromBytes(config, stateBytes) as typeof ssz.phase0.BeaconState;
  const stateView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
  const stateFieldRanges = stateType.getFieldRanges(stateView, 0, stateBytes.length);
  const stateFields = Object.keys(stateType.fields);
  const validatorsFieldIndex = stateFields.indexOf("validators");
  const validatorsRange = stateFieldRanges[validatorsFieldIndex];
  const validatorsBytes = stateBytes.subarray(validatorsRange.start, validatorsRange.end);
  const validatorSize = ssz.phase0.Validator.fixedSize as number;

  const effectiveBalances: number[] = [];

  for (const index of validatorIndices) {
    const validatorBytes = validatorsBytes.subarray(index * validatorSize, (index + 1) * validatorSize);
    if (validatorBytes.byteLength === 0) {
      throw Error(`Validator index ${index} out of range`);
    }
    const validator = ssz.phase0.Validator.deserialize(validatorBytes);
    effectiveBalances.push(validator.effectiveBalance);
  }

  return effectiveBalances;
}
