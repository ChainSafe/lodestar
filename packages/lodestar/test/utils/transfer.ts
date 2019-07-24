import {Transfer} from "@chainsafe/eth2.0-types";
import BN from "bn.js";
import {EMPTY_SIGNATURE} from "@chainsafe/eth2.0-constants";

export function generateEmptyTransfer(): Transfer {
  return {
    slot: 0,
    amount: new BN(0),
    fee: new BN(0),
    pubkey: Buffer.alloc(48, 0),
    recipient: 0,
    sender: 0,
    signature: EMPTY_SIGNATURE
  };
}
