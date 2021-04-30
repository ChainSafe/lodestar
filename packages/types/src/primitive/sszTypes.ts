import {
  byteType,
  booleanType,
  ByteVectorType,
  BigIntUintType,
  number32Type,
  NumberUintType,
  BooleanType,
} from "@chainsafe/ssz";

export interface PrimitiveSSZTypes {
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
  SubCommitteeIndex: NumberUintType;
  ValidatorIndex: NumberUintType;
  Gwei: BigIntUintType;
  Root: ByteVectorType;
  Version: ByteVectorType;
  DomainType: ByteVectorType;
  ForkDigest: ByteVectorType;
  BLSPubkey: ByteVectorType;
  BLSSignature: ByteVectorType;
  Domain: ByteVectorType;
  ParticipationFlags: NumberUintType;
}

export function getPrimitiveTypes(): PrimitiveSSZTypes {
  const Boolean = booleanType;
  const Bytes4 = new ByteVectorType({length: 4});
  const Bytes8 = new ByteVectorType({length: 8});
  const Bytes32 = new ByteVectorType({length: 32});
  const Bytes48 = new ByteVectorType({length: 48});
  const Bytes96 = new ByteVectorType({length: 96});
  const Uint8 = byteType;
  const Uint16 = new NumberUintType({byteLength: 2});
  const Uint32 = number32Type;
  const Number64 = new NumberUintType({byteLength: 8});
  const Uint64 = new BigIntUintType({byteLength: 8});
  const Uint128 = new BigIntUintType({byteLength: 16});
  const Uint256 = new BigIntUintType({byteLength: 32});

  // Custom types, defined for type hinting and readability
  const Slot = Number64;
  const Epoch = Number64;
  const CommitteeIndex = Number64;
  const SubCommitteeIndex = Number64;
  const ValidatorIndex = Number64;
  const Gwei = Uint64;
  const Root = Bytes32;
  const Version = Bytes4;
  const DomainType = Bytes4;
  const ForkDigest = Bytes4;
  const BLSPubkey = Bytes48;
  const BLSSignature = Bytes96;
  const Domain = Bytes32;
  const ParticipationFlags = Uint8;

  return {
    Boolean,
    Bytes4,
    Bytes8,
    Bytes32,
    Bytes48,
    Bytes96,
    Uint8,
    Uint16,
    Uint32,
    Number64,
    Uint64,
    Uint128,
    Uint256,

    // Custom types, defined for type hinting and readability
    Slot,
    Epoch,
    CommitteeIndex,
    SubCommitteeIndex,
    ValidatorIndex,
    Gwei,
    Root,
    Version,
    DomainType,
    ForkDigest,
    BLSPubkey,
    BLSSignature,
    Domain,
    ParticipationFlags,
  };
}
