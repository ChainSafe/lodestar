import {ByteViews, ContainerNodeStructType, ValueOfFields} from "@chainsafe/ssz";
import * as primitiveSsz from "../primitive/sszTypes.js";

const {Boolean, Bytes32, UintNum64, BLSPubkey, EpochInf} = primitiveSsz;

// this is to work with uint32, see https://github.com/ChainSafe/ssz/blob/ssz-v0.15.1/packages/ssz/src/type/uint.ts
const NUMBER_2_POW_32 = 2 ** 32;

/*
 * Below constants are respective to their ssz type in `ValidatorType`.
 */
const UINT32_SIZE = 4;
const PUBKEY_SIZE = 48;
const WITHDRAWAL_CREDENTIALS_SIZE = 32;
const SLASHED_SIZE = 1;
const CHUNK_SIZE = 32;

export const ValidatorType = {
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  effectiveBalance: UintNum64,
  slashed: Boolean,
  activationEligibilityEpoch: EpochInf,
  activationEpoch: EpochInf,
  exitEpoch: EpochInf,
  withdrawableEpoch: EpochInf,
};

/**
 * Improve serialization performance for state.validators.serialize();
 */
export class ValidatorNodeStructType extends ContainerNodeStructType<typeof ValidatorType> {
  constructor() {
    super(ValidatorType, {typeName: "Validator", jsonCase: "eth2"});
  }

  value_serializeToBytes(
    {uint8Array: output, dataView}: ByteViews,
    offset: number,
    validator: ValueOfFields<typeof ValidatorType>
  ): number {
    output.set(validator.pubkey, offset);
    offset += PUBKEY_SIZE;
    output.set(validator.withdrawalCredentials, offset);
    offset += WITHDRAWAL_CREDENTIALS_SIZE;
    const {effectiveBalance, activationEligibilityEpoch, activationEpoch, exitEpoch, withdrawableEpoch} = validator;
    // effectiveBalance is UintNum64
    dataView.setUint32(offset, effectiveBalance & 0xffffffff, true);
    offset += UINT32_SIZE;
    dataView.setUint32(offset, (effectiveBalance / NUMBER_2_POW_32) & 0xffffffff, true);
    offset += UINT32_SIZE;
    output[offset] = validator.slashed ? 1 : 0;
    offset += SLASHED_SIZE;
    offset = writeEpochInf(dataView, offset, activationEligibilityEpoch);
    offset = writeEpochInf(dataView, offset, activationEpoch);
    offset = writeEpochInf(dataView, offset, exitEpoch);
    offset = writeEpochInf(dataView, offset, withdrawableEpoch);

    return offset;
  }
}

export const ValidatorNodeStruct = new ValidatorNodeStructType();

/**
 * Write to level3 and level4 bytes to compute merkle root. Note that this is to compute
 * merkle root and it's different from serialization (which is more compressed).
 * pub0 + pub1 are at level4, they will be hashed to 1st chunked of level 3
 * then use 8 chunks of level 3 to compute the root hash.
 *           reserved     withdr     eff        sla        actElig    act        exit       with
 * level 3 |----------|----------|----------|----------|----------|----------|----------|----------|
 *
 *            pub0       pub1
 * level4  |----------|----------|
 *
 */
export function validatorToChunkBytes(
  level3: ByteViews,
  level4: Uint8Array,
  value: ValueOfFields<typeof ValidatorType>
): void {
  const {
    pubkey,
    withdrawalCredentials,
    effectiveBalance,
    slashed,
    activationEligibilityEpoch,
    activationEpoch,
    exitEpoch,
    withdrawableEpoch,
  } = value;
  const {uint8Array: outputLevel3, dataView} = level3;

  // pubkey = 48 bytes which is 2 * CHUNK_SIZE
  level4.set(pubkey, 0);
  let offset = CHUNK_SIZE;
  outputLevel3.set(withdrawalCredentials, offset);
  offset += CHUNK_SIZE;
  // effectiveBalance is UintNum64
  dataView.setUint32(offset, effectiveBalance & 0xffffffff, true);
  dataView.setUint32(offset + 4, (effectiveBalance / NUMBER_2_POW_32) & 0xffffffff, true);

  offset += CHUNK_SIZE;
  dataView.setUint32(offset, slashed ? 1 : 0, true);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, activationEligibilityEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, activationEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, exitEpoch);
  offset += CHUNK_SIZE;
  writeEpochInf(dataView, offset, withdrawableEpoch);
}

function writeEpochInf(dataView: DataView, offset: number, value: number): number {
  if (value === Infinity) {
    dataView.setUint32(offset, 0xffffffff, true);
    offset += UINT32_SIZE;
    dataView.setUint32(offset, 0xffffffff, true);
    offset += UINT32_SIZE;
  } else {
    dataView.setUint32(offset, value & 0xffffffff, true);
    offset += UINT32_SIZE;
    dataView.setUint32(offset, (value / NUMBER_2_POW_32) & 0xffffffff, true);
    offset += UINT32_SIZE;
  }
  return offset;
}
