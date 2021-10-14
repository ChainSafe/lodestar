/**
 * @module eth1
 */

import {Interface} from "@ethersproject/abi";
import {fromHexString} from "@chainsafe/ssz";
import {phase0, ssz} from "@chainsafe/lodestar-types";

const depositEventFragment =
  "event DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index)";

const depositContractInterface = new Interface([depositEventFragment]);

/**
 * Precomputed topics of DepositEvent logs
 */
export const depositEventTopics = [depositContractInterface.getEventTopic("DepositEvent")];

/**
 * Parse DepositEvent log
 */
export function parseDepositLog(log: {blockNumber: number; data: string; topics: string[]}): phase0.DepositEvent {
  const event = depositContractInterface.parseLog(log);
  const values = event.args;
  if (values === undefined) throw Error(`DepositEvent at ${log.blockNumber} has no values`);
  return {
    blockNumber: log.blockNumber,
    index: ssz.Number64.deserialize(fromHexString(values.index)),
    depositData: {
      pubkey: fromHexString(values.pubkey),
      withdrawalCredentials: fromHexString(values.withdrawal_credentials),
      amount: ssz.Number64.deserialize(fromHexString(values.amount)),
      signature: fromHexString(values.signature),
    },
  };
}
