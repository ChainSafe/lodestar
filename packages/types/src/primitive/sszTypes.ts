import {
  byteType,
  booleanType,
  ByteVectorType,
  BigIntUintType,
  number32Type,
  NumberUintType,
  RootType,
  Number64UintType,
} from "@chainsafe/ssz";

export const Boolean = booleanType;
export const Bytes4 = new ByteVectorType({length: 4});
export const Bytes8 = new ByteVectorType({length: 8});
export const Bytes20 = new ByteVectorType({length: 20});
export const Bytes32 = new ByteVectorType({length: 32});
export const Bytes48 = new ByteVectorType({length: 48});
export const Bytes96 = new ByteVectorType({length: 96});
export const Uint8 = byteType;
export const Uint16 = new NumberUintType({byteLength: 2});
export const Uint32 = number32Type;
export const Number64 = new Number64UintType();
export const Uint64 = new BigIntUintType({byteLength: 8});
export const Uint128 = new BigIntUintType({byteLength: 16});
export const Uint256 = new BigIntUintType({byteLength: 32});

// Custom types, defined for type hinting and readability
export const Slot = Number64;
export const Epoch = Number64;
export const CommitteeIndex = Number64;
export const SubcommitteeIndex = Number64;
export const ValidatorIndex = Number64;
export const Gwei = Uint64;
export const Root = new RootType({
  expandedType: () => {
    throw new Error("Generic Root type has no expanded type");
  },
});
export const Version = Bytes4;
export const DomainType = Bytes4;
export const ForkDigest = Bytes4;
export const BLSPubkey = Bytes48;
export const BLSSignature = Bytes96;
export const Domain = Bytes32;
export const ParticipationFlags = Uint8;
export const ExecutionAddress = Bytes20;
