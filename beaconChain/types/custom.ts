import {
  bytes32,
  bytes48,
  bytes96,
  uint64,
} from "./primitive";

export type SlotNumber = uint64;
export type EpochNumber = uint64;
export type ShardNumber = uint64;
export type ValidatorIndex = uint64;
export type Gwei = uint64;
export type Bytes32 = bytes32;
export type BLSPubkey = bytes48;
export type BLSSignature = bytes96;

export const SlotNumber = uint64;
export const EpochNumber = uint64;
export const ShardNumber = uint64;
export const ValidatorIndex = uint64;
export const Gwei = uint64;
export const Bytes32 = bytes32;
export const BLSPubkey = bytes48;
export const BLSSignature = bytes96;
