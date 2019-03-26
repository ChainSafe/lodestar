import {
  bytes32,
  bytes48,
  bytes96,
  number64,
  uint64,
} from "./primitive";

export type Slot = number64;
export type Epoch = number64;
export type Shard = number64;
export type ValidatorIndex = number64;
export type Gwei = uint64;
export type Bytes32 = bytes32;
export type BLSPubkey = bytes48;
export type BLSSignature = bytes96;

export const Slot = number64;
export const Epoch = number64;
export const Shard = number64;
export const ValidatorIndex = number64;
export const Gwei = uint64;
export const Bytes32 = bytes32;
export const BLSPubkey = bytes48;
export const BLSSignature = bytes96;
