import {ByteViews, ContainerNodeStructType, ValueOfFields} from "@chainsafe/ssz";
import * as primitiveSsz from "../primitive/sszTypes.js";

const {Boolean, Bytes32, UintNum64, BLSPubkey, EpochInf} = primitiveSsz;

const NUMBER_2_POW_32 = 2 ** 32;

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
    offset += 48;
    output.set(validator.withdrawalCredentials, offset);
    offset += 32;
    const {effectiveBalance, activationEligibilityEpoch, activationEpoch, exitEpoch, withdrawableEpoch} = validator;
    // TODO: writeUintNum64?
    dataView.setUint32(offset, effectiveBalance & 0xffffffff, true);
    offset += 4;
    dataView.setUint32(offset, (effectiveBalance / NUMBER_2_POW_32) & 0xffffffff, true);
    offset += 4;
    output[offset] = validator.slashed ? 1 : 0;
    offset += 1;
    offset = writeEpochInf(dataView, offset, activationEligibilityEpoch);
    offset = writeEpochInf(dataView, offset, activationEpoch);
    offset = writeEpochInf(dataView, offset, exitEpoch);
    offset = writeEpochInf(dataView, offset, withdrawableEpoch);

    return offset;
  }
}

function writeEpochInf(dataView: DataView, offset: number, value: number): number {
  if (value === Infinity) {
    dataView.setUint32(offset, 0xffffffff, true);
    offset += 4;
    dataView.setUint32(offset, 0xffffffff, true);
    offset += 4;
  } else {
    dataView.setUint32(offset, value & 0xffffffff, true);
    offset += 4;
    dataView.setUint32(offset, (value / NUMBER_2_POW_32) & 0xffffffff, true);
    offset += 4;
  }
  return offset;
}
export const ValidatorNodeStruct = new ValidatorNodeStructType();
