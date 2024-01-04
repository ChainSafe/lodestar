import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {Slot, allForks} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";

/**
 * Slot	uint64
 */
const SLOT_BYTE_COUNT = 8;

/**
 * 48 + 32 + 8 + 1 + 8 + 8 + 8 + 8 = 121
 * ```
 * class Validator(Container):
    pubkey: BLSPubkey [fixed - 48 bytes]
    withdrawal_credentials: Bytes32 [fixed - 32 bytes]
    effective_balance: Gwei [fixed - 8 bytes]
    slashed: boolean [fixed - 1 byte]
    # Status epochs
    activation_eligibility_epoch: Epoch [fixed - 8 bytes]
    activation_epoch: Epoch [fixed - 8 bytes]
    exit_epoch: Epoch [fixed - 8 bytes]
    withdrawable_epoch: Epoch [fixed - 8 bytes]
  ```
 */
export const VALIDATOR_BYTES_SIZE = 121;

const BLS_PUBKEY_SIZE = 48;

export function getWithdrawalCredentialFirstByteFromValidatorBytes(
  validatorBytes: Uint8Array,
  validatorIndex: number
): number | null {
  if (validatorBytes.length < VALIDATOR_BYTES_SIZE * (validatorIndex + 1)) {
    return null;
  }

  return validatorBytes[VALIDATOR_BYTES_SIZE * validatorIndex + BLS_PUBKEY_SIZE];
}

/**
 * 8 + 32 = 40
 * ```
 * class BeaconState(Container):
 *   genesis_time: uint64 [fixed - 8 bytes]
 *   genesis_validators_root: Root [fixed - 32 bytes]
 *   slot: Slot [fixed - 8 bytes]
 *   ...
 * ```
 */
const SLOT_BYTES_POSITION_IN_STATE = 40;

export function getForkFromStateBytes(config: ChainForkConfig, bytes: Buffer | Uint8Array): ForkSeq {
  const slot = bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
  return config.getForkSeq(slot);
}

export function getStateTypeFromBytes(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksSSZTypes["BeaconState"] {
  const slot = getStateSlotFromBytes(bytes);
  return config.getForkTypes(slot).BeaconState;
}

export function getStateSlotFromBytes(bytes: Uint8Array): Slot {
  return bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
}
