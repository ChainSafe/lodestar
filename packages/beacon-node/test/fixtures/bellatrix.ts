import {ssz, bellatrix} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {BlockGenerationOptionsAltair, generateAltairBeaconBlocks} from "./altair.js";

export function generateBellatrixExecutionPayload(): bellatrix.ExecutionPayload {
  return {
    baseFeePerGas: BigInt(0),
    blockHash: new Uint8Array(),
    blockNumber: 0,
    extraData: new Uint8Array(),
    feeRecipient: new Uint8Array(),
    gasLimit: 0,
    gasUsed: 0,
    logsBloom: new Uint8Array(),
    parentHash: new Uint8Array(),
    prevRandao: new Uint8Array(),
    receiptsRoot: new Uint8Array(),
    stateRoot: new Uint8Array(),
    timestamp: 0,
    transactions: [ssz.bellatrix.Transaction.defaultValue()],
  };
}

export interface BlockGenerationOptionsBellatrix extends BlockGenerationOptionsAltair {}

export function generateBellatrixBeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsBellatrix
): bellatrix.BeaconBlock[] {
  const blocks = generateAltairBeaconBlocks(state, count, opts) as bellatrix.BeaconBlock[];
  for (const block of blocks) {
    block.body.executionPayload = generateBellatrixExecutionPayload();
  }
  return blocks;
}
