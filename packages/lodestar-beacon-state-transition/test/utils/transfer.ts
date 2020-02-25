import {Transfer} from "@chainsafe/lodestar-types";
import {EMPTY_SIGNATURE} from "../../src/constants";

export function generateEmptyTransfer(): Transfer {
  return {
    slot: 0,
    amount: 0n,
    fee: 0n,
    pubkey: Buffer.alloc(48, 0),
    recipient: 0,
    sender: 0,
    signature: EMPTY_SIGNATURE
  };
}
