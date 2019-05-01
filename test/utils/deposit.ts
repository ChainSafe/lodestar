import {Deposit} from "../../src/types";
import {randBetween} from "./misc";
import {MAX_EFFECTIVE_BALANCE, MIN_DEPOSIT_AMOUNT} from "../../src/constants";
import BN from "bn.js";

/**
 * Generates a fake attestation data for test purposes.
 * @returns {Deposit}
 * @param index
 */
export function generateDeposit(index: number): Deposit {
  return {
    index,
    proof: [],
    data: {
      amount: new BN(randBetween(MIN_DEPOSIT_AMOUNT, MAX_EFFECTIVE_BALANCE).toString()),
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      signature: Buffer.alloc(48)
    }
  };
}
