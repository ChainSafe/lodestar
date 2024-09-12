import {Interface} from "@ethersproject/abi";
import {phase0, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";

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
    index: parseHexNumLittleEndian(values.index),
    depositData: {
      pubkey: fromHex(values.pubkey),
      withdrawalCredentials: fromHex(values.withdrawal_credentials),
      amount: parseHexNumLittleEndian(values.amount),
      signature: fromHex(values.signature),
    },
  };
}

function parseHexNumLittleEndian(hex: string): number {
  // Can't use parseInt() because amount is a hex string in little endian
  return ssz.UintNum64.deserialize(fromHex(hex));
}
