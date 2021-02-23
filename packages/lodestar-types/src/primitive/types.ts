/**
 * @module types
 */

// Each type exported here contains both a compile-time type
// (a typescript interface) and a run-time ssz type (a javascript variable)
// For more information, see ./index.ts

import {ByteVector} from "@chainsafe/ssz";

export type Bytes4 = ByteVector;
export type Bytes8 = ByteVector;
export type Bytes20 = ByteVector;
export type Bytes32 = ByteVector;
export type Bytes48 = ByteVector;
export type Bytes96 = ByteVector;
export type Uint8 = number;
export type Uint16 = number;
export type Uint32 = number;
export type Number64 = number;
export type Uint64 = bigint;
export type Uint128 = bigint;
export type Uint256 = bigint;

// Custom types, defined for type hinting and readability

export type Slot = Number64;
export type Epoch = Number64;
export type CommitteeIndex = Number64;
export type ValidatorIndex = Number64;
export type Gwei = Uint64;
export type Root = Bytes32;
export type Version = Bytes4;
export type DomainType = Bytes4;
export type ForkDigest = Bytes4;
export type Domain = Bytes32;
export type BLSPubkey = Bytes48;
export type BLSSecretKey = Bytes32;
export type BLSSignature = Bytes96;
export type BlockRootHex = string;
export type AttestationRootHex = string;
export type ValidatorFlag = Uint8;
