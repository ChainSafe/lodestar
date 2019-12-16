/**
 * @module sszTypes/generators
 */

export const bool = "bool";
export const bytes4 = "bytes4";
export const bytes8 = "bytes8";
export const bytes32 = "bytes32";
export const bytes48 = "bytes48";
export const bytes96 = "bytes96";
export const uint8 = "number8";
export const uint16 = "number16";
export const number64 = "number64";
export const uint64 = "bigint64";
export const uint256 = "bigint256";

// Custom types, defined for type hinting and readability

export const Slot = number64;
export const Epoch = number64;
export const Shard = number64;
export const ValidatorIndex = number64;
export const Gwei = uint64;
export const Hash = bytes32;
export const Version = bytes4;
export const BLSPubkey = bytes48;
export const BLSSignature = bytes96;
