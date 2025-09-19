import {bellatrix} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {Assertion, AssertionResult, Match} from "../interfaces.js";

export function createExecutionHeadAssertion({
  checkForSlot,
}: {
  checkForSlot: number[];
}): Assertion<
  "executionHead",
  {executionHead: {hash: string}; consensusHead: {executionPayload: {blockHash: string}}}
> {
  return {
    id: "executionHead",
    match({slot}) {
      if (checkForSlot.includes(slot)) return Match.Capture | Match.Assert;
      return Match.None;
    },
    async capture({node}) {
      const blockNumber = await node.execution.provider?.eth.getBlockNumber();
      if (blockNumber == null) throw new Error("Execution provider not available");
      const executionHeadBlock = await node.execution.provider?.eth.getBlock(blockNumber);

      const consensusHead = (await node.beacon.api.beacon.getBlockV2({blockId: "head"})).value();

      return {
        executionHead: {hash: executionHeadBlock?.hash ?? "0x0"},
        consensusHead: {
          executionPayload: {
            blockHash: toHex((consensusHead.message as bellatrix.BeaconBlock).body.executionPayload.blockHash),
          },
        },
      };
    },
    async assert({store, slot}) {
      const errors: AssertionResult[] = [];

      if (store[slot].executionHead.hash !== store[slot].consensusHead.executionPayload.blockHash) {
        errors.push(
          `Execution head does not match consensus head. Expected: ${store[slot].consensusHead.executionPayload.blockHash}, got: ${store[slot].executionHead.hash}`
        );
      }

      return errors;
    },
  };
}
