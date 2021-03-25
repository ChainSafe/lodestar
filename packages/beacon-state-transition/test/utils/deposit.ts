import {phase0} from "@chainsafe/lodestar-types";
import {DEPOSIT_CONTRACT_TREE_DEPTH, EMPTY_SIGNATURE} from "../../src/constants";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {Deposit}
 * @param index
 */
export function generateDeposit(): phase0.Deposit {
  return {
    proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}, () => Buffer.alloc(32)),
    data: {
      amount: BigInt(32) * BigInt(10) * BigInt(9),
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      signature: EMPTY_SIGNATURE,
    },
  };
}
