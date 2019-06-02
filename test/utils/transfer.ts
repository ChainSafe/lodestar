import {Transfer} from "../../src/types";
import BN from "bn.js";
import {EMPTY_SIGNATURE} from "../../src/constants";
import transfers from "../../src/chain/stateTransition/block/transfers";


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

export function transfersFromYaml(value: any): Transfer {
  return {
    amount: value.amount,
    fee: value.fee,
    pubkey: Buffer.from(value.pubkey.slice(2), 'hex'),
    recipient: value.recipient.toNumber(),
    sender: value.sender.toNumber(),
    signature: Buffer.from(value.signature.slice(2), 'hex'),
    slot: value.slot.toNumber(),
  };
}
