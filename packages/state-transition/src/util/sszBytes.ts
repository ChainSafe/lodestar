import {ChainForkConfig} from "@lodestar/config";
import {EFFECTIVE_BALANCE_INCREMENT, ForkAll, ForkSeq} from "@lodestar/params";
import {Epoch, SSZTypesFor, Slot, ssz} from "@lodestar/types";
import {LodestarError, bytesToInt} from "@lodestar/utils";

const UINT64_SIZE = 8;
const ROOT_SIZE = 32;

/**
 * ```
 * class Validator(Container):
 *   pubkey: BLSPubkey [fixed - 48 bytes]
 *   withdrawal_credentials: Bytes32 [fixed - 32 bytes]
 *   effective_balance: Gwei [fixed - 8 bytes]
 *   slashed: boolean [fixed - 1 byte]
 *   activation_eligibility_epoch: Epoch [fixed - 8 bytes]
 *   activation_epoch: Epoch [fixed - 8 bytes]
 *   exit_epoch: Epoch [fixed - 8 bytes]
 *   withdrawable_epoch: Epoch [fixed - 8 bytes]
 * ```
 */
const VALIDATOR_EFFECTIVE_BALANCE_OFFSET = 48 + ROOT_SIZE;
const VALIDATOR_ACTIVATION_EPOCH_OFFSET = VALIDATOR_EFFECTIVE_BALANCE_OFFSET + UINT64_SIZE + 1 + UINT64_SIZE;
const VALIDATOR_EXIT_EPOCH_OFFSET = VALIDATOR_ACTIVATION_EPOCH_OFFSET + UINT64_SIZE;
export const VALIDATOR_BYTES_SIZE = VALIDATOR_EXIT_EPOCH_OFFSET + UINT64_SIZE + UINT64_SIZE;

/**
 * ```
 * class BeaconState(Container):
 *   genesis_time: uint64 [fixed - 8 bytes]
 *   genesis_validators_root: Root [fixed - 32 bytes]
 *   slot: Slot [fixed - 8 bytes]
 *   ...
 * ```
 */
const STATE_GENESIS_TIME_OFFSET = 0;
const STATE_GENESIS_VALIDATORS_ROOT_OFFSET = STATE_GENESIS_TIME_OFFSET + UINT64_SIZE;
const STATE_SLOT_OFFSET = STATE_GENESIS_VALIDATORS_ROOT_OFFSET + ROOT_SIZE;

export function getForkFromStateBytes(config: ChainForkConfig, bytes: Uint8Array): ForkSeq {
  const slot = bytesToInt(bytes.subarray(STATE_SLOT_OFFSET, STATE_SLOT_OFFSET + UINT64_SIZE));
  return config.getForkSeq(slot);
}

export function getStateTypeFromBytes(config: ChainForkConfig, bytes: Uint8Array): SSZTypesFor<ForkAll, "BeaconState"> {
  const slot = getStateSlotFromBytes(bytes);
  return config.getForkTypes(slot).BeaconState;
}

export function getStateSlotFromBytes(bytes: Uint8Array): Slot {
  return bytesToInt(bytes.subarray(STATE_SLOT_OFFSET, STATE_SLOT_OFFSET + UINT64_SIZE));
}

export type StateBytesMetadata = {slot: Slot; genesisTime: number; genesisValidatorsRoot: Uint8Array};

class StateBytesError extends LodestarError<{code: "MALFORMED_STATE_BYTES"; reason: string}> {
  constructor(reason: string, cause?: unknown) {
    super({code: "MALFORMED_STATE_BYTES", reason}, `Malformed state bytes: ${reason}`);
    this.cause = cause;
  }
}

export function readBeaconStateBytesMetadata(bytes: Uint8Array): StateBytesMetadata {
  if (bytes.length < STATE_SLOT_OFFSET + UINT64_SIZE) {
    throw new StateBytesError("Missing genesis identity or slot");
  }
  const data = {uint8Array: bytes, dataView: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)};
  return {
    genesisTime: ssz.UintNum64.value_deserializeFromBytes(
      data,
      STATE_GENESIS_TIME_OFFSET,
      STATE_GENESIS_TIME_OFFSET + UINT64_SIZE
    ),
    genesisValidatorsRoot: Uint8Array.from(
      bytes.subarray(STATE_GENESIS_VALIDATORS_ROOT_OFFSET, STATE_GENESIS_VALIDATORS_ROOT_OFFSET + ROOT_SIZE)
    ),
    slot: ssz.Slot.value_deserializeFromBytes(data, STATE_SLOT_OFFSET, STATE_SLOT_OFFSET + UINT64_SIZE),
  };
}

/** Read only the validator fields needed for weak subjectivity, without allocating validator objects. */
export function scanActiveValidatorsFromStateBytes(
  stateBytes: Uint8Array,
  stateType: SSZTypesFor<ForkAll, "BeaconState">,
  epoch: Epoch
): {activeValidatorCount: number; totalActiveBalanceIncrements: number} {
  const data = {
    uint8Array: stateBytes,
    dataView: new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength),
  };
  let range: {start: number; end: number};
  try {
    const containerType = stateType as (typeof ssz)[ForkAll]["BeaconState"];
    const ranges = containerType.getFieldRanges(data.dataView, 0, stateBytes.length);
    range = ranges[Object.keys(containerType.fields).indexOf("validators")];
    if (!range || range.start < 0 || range.end > stateBytes.length || range.end < range.start) {
      throw new StateBytesError("Invalid validator range");
    }
  } catch (error) {
    throw new StateBytesError("Invalid SSZ field ranges", error);
  }
  if ((range.end - range.start) % VALIDATOR_BYTES_SIZE !== 0) {
    throw new StateBytesError("Partial validator record");
  }

  let activeValidatorCount = 0;
  let totalActiveBalanceIncrements = 0;
  for (let offset = range.start; offset < range.end; offset += VALIDATOR_BYTES_SIZE) {
    const activationEpoch = ssz.EpochInf.value_deserializeFromBytes(
      data,
      offset + VALIDATOR_ACTIVATION_EPOCH_OFFSET,
      offset + VALIDATOR_ACTIVATION_EPOCH_OFFSET + UINT64_SIZE
    );
    const exitEpoch = ssz.EpochInf.value_deserializeFromBytes(
      data,
      offset + VALIDATOR_EXIT_EPOCH_OFFSET,
      offset + VALIDATOR_EXIT_EPOCH_OFFSET + UINT64_SIZE
    );
    if (activationEpoch <= epoch && epoch < exitEpoch) {
      activeValidatorCount++;
      const effectiveBalance = ssz.UintNum64.value_deserializeFromBytes(
        data,
        offset + VALIDATOR_EFFECTIVE_BALANCE_OFFSET,
        offset + VALIDATOR_EFFECTIVE_BALANCE_OFFSET + UINT64_SIZE
      );
      totalActiveBalanceIncrements += Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
    }
  }
  return {activeValidatorCount, totalActiveBalanceIncrements: Math.max(1, totalActiveBalanceIncrements)};
}
