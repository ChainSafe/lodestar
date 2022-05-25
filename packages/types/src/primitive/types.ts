import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

// Each type exported here contains both a compile-time type
// (a typescript interface) and a run-time ssz type (a javascript variable)
// For more information, see ./index.ts

export type Bytes4 = ValueOf<typeof ssz.Bytes4>;
export type Bytes8 = ValueOf<typeof ssz.Bytes8>;
export type Bytes20 = ValueOf<typeof ssz.Bytes20>;
export type Bytes32 = ValueOf<typeof ssz.Bytes32>;
export type Bytes48 = ValueOf<typeof ssz.Bytes48>;
export type Bytes96 = ValueOf<typeof ssz.Bytes96>;
export type Uint8 = ValueOf<typeof ssz.Uint8>;
export type Uint16 = ValueOf<typeof ssz.Uint16>;
export type Uint32 = ValueOf<typeof ssz.Uint32>;
export type UintNum64 = ValueOf<typeof ssz.UintNum64>;
export type UintNumInf64 = ValueOf<typeof ssz.UintNumInf64>;
export type UintBn64 = ValueOf<typeof ssz.UintBn64>;
export type UintBn128 = ValueOf<typeof ssz.UintBn128>;
export type UintBn256 = ValueOf<typeof ssz.UintBn256>;

// Custom types, defined for type hinting and readability

export type Slot = UintNumInf64;
export type Epoch = UintNumInf64;
export type SyncPeriod = UintNum64;
export type CommitteeIndex = UintNum64;
export type SubcommitteeIndex = UintNum64;
export type ValidatorIndex = UintNum64;
export type Gwei = UintBn64;
export type Root = Bytes32;
export type Version = Bytes4;
export type DomainType = Bytes4;
export type ForkDigest = Bytes4;
export type Domain = Bytes32;
export type BLSPubkey = Bytes48;
export type BLSSecretKey = Bytes32;
export type BLSSignature = Bytes96;
export type ParticipationFlags = Uint8;
export type ExecutionAddress = Bytes20;

/** Common non-spec type to represent roots as strings */
export type RootHex = string;
/** Non-spec type to signal time is represented in seconds */
export type TimeSeconds = number;
