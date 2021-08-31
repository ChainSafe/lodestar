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
    data: generateDepositData(),
  };
}

export function generateDepositEvent(index: number, blockNumber = 0): phase0.DepositEvent {
  return {
    index,
    blockNumber,
    depositData: generateDepositData(),
  };
}

export function generateDepositData(): phase0.DepositData {
  return {
    amount: 32 * 10 * 9,
    pubkey: Buffer.alloc(48),
    withdrawalCredentials: Buffer.alloc(32),
    signature: EMPTY_SIGNATURE,
  };
}
