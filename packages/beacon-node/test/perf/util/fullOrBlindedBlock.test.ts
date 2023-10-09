import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {bellatrix, capella, ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {chainConfig, mockBlocks} from "../../utils/mocks/block.js";
import {
  blindedOrFullBlockToBlinded,
  blindedOrFullBlockToBlindedBytes,
  blindedOrFullBlockToFull,
  blindedOrFullBlockToFullBytes,
} from "../../../src/util/fullOrBlindedBlock.js";
import {ExecutionPayloadBody} from "../../../src/execution/engine/types.js";

describe("fullOrBlindedBlock", () => {
  setBenchOpts({noThreshold: true});

  describe("BlindedOrFull to full", () => {
    for (const {forkInfo, full, fullSerialized} of mockBlocks) {
      describe(forkInfo.name, () => {
        itBench({
          id: `${forkInfo.name} to full - deserialize first`,
          beforeEach: () => {
            const transactionsAndWithdrawals: Partial<ExecutionPayloadBody> = {};
            if (forkInfo.seq > ForkSeq.bellatrix) {
              transactionsAndWithdrawals.transactions = (
                full.message.body as bellatrix.BeaconBlockBody
              ).executionPayload.transactions;
            }
            if (forkInfo.seq > ForkSeq.capella) {
              transactionsAndWithdrawals.withdrawals = (
                full.message.body as capella.BeaconBlockBody
              ).executionPayload.withdrawals;
            }
            return transactionsAndWithdrawals;
          },
          fn: (transactionsAndWithdrawals) => {
            const deserialized = ssz[forkInfo.name].SignedBeaconBlock.deserialize(fullSerialized);
            blindedOrFullBlockToFull(chainConfig, forkInfo.seq, deserialized, transactionsAndWithdrawals);
          },
        });
        itBench({
          id: `${forkInfo.name} to full - convert serialized`,
          beforeEach: () => {
            const transactionsAndWithdrawals: Partial<ExecutionPayloadBody> = {};
            if (forkInfo.seq > ForkSeq.bellatrix) {
              transactionsAndWithdrawals.transactions = (
                full.message.body as bellatrix.BeaconBlockBody
              ).executionPayload.transactions;
            }
            if (forkInfo.seq > ForkSeq.capella) {
              transactionsAndWithdrawals.withdrawals = (
                full.message.body as capella.BeaconBlockBody
              ).executionPayload.withdrawals;
            }
            return transactionsAndWithdrawals;
          },
          fn: async (transactionsAndWithdrawals) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of blindedOrFullBlockToFullBytes(
              forkInfo.seq,
              fullSerialized,
              Promise.resolve(transactionsAndWithdrawals)
            )) {
              chunks.push(chunk);
            }
          },
        });
      });
    }
  });

  describe("BlindedOrFull to blinded", () => {
    for (const {forkInfo, full, fullSerialized} of mockBlocks) {
      describe(forkInfo.name, () => {
        itBench({
          id: `${forkInfo.name} to blinded - deserialize first`,
          fn: () => {
            const deserialized = ssz[forkInfo.name].SignedBeaconBlock.deserialize(fullSerialized);
            blindedOrFullBlockToBlinded(chainConfig, deserialized);
          },
        });

        itBench({
          id: `${forkInfo.name} to blinded - convert serialized`,
          fn: () => {
            blindedOrFullBlockToBlindedBytes(chainConfig, full, fullSerialized);
          },
        });
      });
    }
  });
});
