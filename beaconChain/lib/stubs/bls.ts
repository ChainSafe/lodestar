import {
  bool,
  bytes32,
  bytes48,
  bytes96,
  int,
  uint64,
} from "../../types";

// TODO: unstub this, connect bls-js repo

export function blsVerify(pubkey: bytes48, messageHash: bytes32, signature: bytes96, domain: uint64): bool {
  return true;
}

export function blsVerifyMultiple(pubkeys: bytes48[], messageHashes: bytes32[], signature: bytes96, domain: uint64): bool {
  return true;
}

export function blsAggregatePubkeys(pubkeys: bytes48[]): bytes48 {
  return Buffer.alloc(48);
}
