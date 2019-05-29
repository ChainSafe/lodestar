/**
 * @module types
 */

// Each type exported here contains both a compile-time type (a typescript interface) and a run-time ssz type (a javascript variable)
// For more information, see ./index.ts
import BN from "bn.js";


export type bool = boolean;
export type bytes = Buffer;
export type bytes4 = Buffer;
export type bytes8 = Buffer;
export type bytes32 = Buffer;
export type bytes48 = Buffer;
export type bytes96 = Buffer;
export type int = number;
export type uint8 = number;
export type uint16 = number;
export type uint24 = number;
export type number64 = number;
export type uint64 = BN;
export type uint384 = BN;

export const bool = "bool";
export const int = "number";
export const bytes = "bytes";
export const bytes4 = "bytes4";
export const bytes8 = "bytes8";
export const bytes32 = "bytes32";
export const bytes48 = "bytes48";
export const bytes96 = "bytes96";
export const uint8 = "uint8";
export const uint16 = "uint16";
export const uint24 = "uint24";
export const number64 = "number64";
export const uint64 = "uint64";
export const uint384 = "uint384";

// Custom types, defined for type hinting and readability

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
