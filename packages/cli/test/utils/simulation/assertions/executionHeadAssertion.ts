import {ApiError} from "@lodestar/api";
import {toHex} from "@lodestar/utils";
import {bellatrix} from "@lodestar/types";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../interfaces.js";

export function createExecutionHeadAssertion({
  checkForSlot,
}: {
  checkForSlot: number[];
}): SimulationAssertion<
  "executionHead",
  {executionHead: {hash: string}; consensusHead: {executionPayload: {blockHash: string}}}
> {
  return {
    id: "executionHead",
    match({slot}) {
      if (checkForSlot.includes(slot)) return AssertionMatch.Capture | AssertionMatch.Assert;
      return AssertionMatch.None;
    },
    async capture({node}) {
      const blockNumber = await node.execution.provider?.getBlockNumber();
      if (blockNumber == null) throw new Error("Execution provider not available");
      const executionHeadBlock = await node.execution.provider?.getBlockByNumber(blockNumber);

      const consensusHead = await node.beacon.api.beacon.getBlockV2("head");
      ApiError.assert(consensusHead);

      return {
        executionHead: {hash: executionHeadBlock?.hash ?? "0x0"},
        consensusHead: {
          executionPayload: {
            blockHash: toHex(
              (consensusHead.response.data.message as bellatrix.BeaconBlock).body.executionPayload.blockHash
            ),
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
