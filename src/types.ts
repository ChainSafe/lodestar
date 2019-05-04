export type bytes32 = Buffer;
export type bytes48 = Buffer;
export type bytes96 = Buffer;

export const bytes32 = "bytes32";
export const bytes48 = "bytes48";
export const bytes96 = "bytes96";

export type BLSPubkey = bytes48;
export type BLSPrivKey = bytes32;
export type BLSSignature = bytes96;
