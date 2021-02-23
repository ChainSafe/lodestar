import {ByteVectorType, BigIntUintType, NumberUintType, BooleanType} from "@chainsafe/ssz";

export interface IPrimitiveSSZTypes {
  Boolean: BooleanType;
  Bytes4: ByteVectorType;
  Bytes8: ByteVectorType;
  Bytes32: ByteVectorType;
  Bytes48: ByteVectorType;
  Bytes96: ByteVectorType;
  Uint8: NumberUintType;
  Uint16: NumberUintType;
  Uint32: NumberUintType;
  Number64: NumberUintType;
  Uint64: BigIntUintType;
  Uint128: BigIntUintType;
  Uint256: BigIntUintType;

  // Custom types, defined for type hinting and readability
  Slot: NumberUintType;
  Epoch: NumberUintType;
  CommitteeIndex: NumberUintType;
  ValidatorIndex: NumberUintType;
  Gwei: BigIntUintType;
  Root: ByteVectorType;
  Version: ByteVectorType;
  DomainType: ByteVectorType;
  ForkDigest: ByteVectorType;
  BLSPubkey: ByteVectorType;
  BLSSignature: ByteVectorType;
  Domain: ByteVectorType;
  ValidatorFlag: NumberUintType;
}
