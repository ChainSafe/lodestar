import {DEPOSIT_CONTRACT_TREE_DEPTH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE} from "../../src/constants/index.js";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {Deposit}
 * @param index
 */
export function generateDeposit(): phase0.Deposit {
  return {
    proof: Array.from({length: DEPOSIT_CONTRACT_TREE_DEPTH + 1}, () => Buffer.alloc(32)),
    data: {
      amount: 32 * 10 * 9,
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      signature: EMPTY_SIGNATURE,
    },
  };
}
