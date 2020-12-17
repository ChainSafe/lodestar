import {Uint64, ValidatorIndex} from "@chainsafe/lodestar-types";

/**
 *  Create a compact validator object representing index, slashed status, and compressed balance.
 *  Takes as input balance-in-increments (// EFFECTIVE_BALANCE_INCREMENT) to preserve symmetry with
 *  the unpacking function.
 */
export function packCompactValidator(index: ValidatorIndex, slashed: boolean, balanceInIncrements: Uint64): Uint64 {
  return BigInt(index << 16) + BigInt((slashed ? 1 : 0) << 15) + balanceInIncrements;
}

/**
 * Return validator index, slashed, balance // EFFECTIVE_BALANCE_INCREMENT
 */
export function unpackCompactValidator(compactValidator: Uint64): [ValidatorIndex, boolean, Uint64] {
  return [
    Number(compactValidator >> BigInt(16)),
    Boolean(compactValidator >> BigInt(15) % BigInt(2)),
    compactValidator & (BigInt(2) ** BigInt(15) - BigInt(1)),
  ];
}
