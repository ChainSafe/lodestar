/**
 * @module types
 */

// Each type exported here contains both a compile-time type
// (a typescript interface) and a run-time ssz type (a javascript variable)
// For more information, see ./index.ts
import BN from "bn.js";

export type bool = boolean;
export type bytes = Buffer;
export type bytes4 = Buffer;
export type bytes8 = Buffer;
export type bytes32 = Buffer;
export type bytes48 = Buffer;
export type bytes96 = Buffer;
export type uint8 = number;
export type uint16 = number;
export type uint24 = number;
export type number64 = number;
export type uint64 = BN;
export type uint256 = BN;

// Custom types, defined for type hinting and readability

export type Slot = number64;
export type Epoch = number64;
export type Shard = number64;
export type ValidatorIndex = number64;
export type Gwei = uint64;
export type Hash = bytes32;
export type Version = bytes4;
export type BLSPubkey = bytes48;
export type BLSSecretKey = bytes32;
export type BLSSignature = bytes96;
export type Domain = bytes8;
