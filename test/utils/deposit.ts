import {Deposit} from "../../src/types";
import {EMPTY_SIGNATURE} from "../../src/constants";
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
      amount: new BN(32).mul(new BN(10).muln(9)),
      pubkey: Buffer.alloc(48),
      withdrawalCredentials: Buffer.alloc(32),
      signature: EMPTY_SIGNATURE
    }
  };
}
