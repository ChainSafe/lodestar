import BN from "bn.js";

// Each type exported here contains both a compile-time type (a typescript interface) and a run-time type (a javascript variable)
// For more information, see ./index.ts

export type bool = boolean;
export type bytes = Buffer;
export type bytes32 = Buffer;
export type bytes48 = Buffer;
export type bytes96 = Buffer;
export type int = number;
export type uint24 = number;
export type number64 = number;
export type uint64 = BN;
export type uint384 = BN;

export const bool = "bool";
export const int = "number";
export const bytes = "bytes";
export const bytes32 = "bytes32";
export const bytes48 = "bytes48";
export const bytes96 = "bytes96";
export const uint24 = "uint24";
export const number64 = "number64";
export const uint64 = "uint64";
export const uint384 = "uint384";

