import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {bellatrix, capella, ssz} from "@lodestar/types";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/presets";
import {mainnetPreset} from "@lodestar/params/presets/mainnet";
import {minimalPreset} from "@lodestar/params/presets/minimal";
import {ForkSeq} from "@lodestar/params";
import {mockBlocks} from "../../utils/mocks/block.js";
import {
  blindedOrFullBlockToBlinded,
  blindedOrFullBlockToBlindedBytes,
  blindedOrFullBlockToFull,
  blindedOrFullBlockToFullBytes,
} from "../../../src/util/fullOrBlindedBlock.js";
import {ExecutionPayloadBody} from "../../../src/execution/engine/types.js";

// calculate slot ratio so that getForkTypes and getBlindedForkTypes return correct fork for minimal configuration
const slotPerEpochRatio =
  defaultChainConfig.CONFIG_NAME === "minimal" ? mainnetPreset.SLOTS_PER_EPOCH / minimalPreset.SLOTS_PER_EPOCH : 1;

/* eslint-disable @typescript-eslint/naming-convention */
const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: mainnetChainConfig.ALTAIR_FORK_EPOCH * slotPerEpochRatio,
  BELLATRIX_FORK_EPOCH: mainnetChainConfig.BELLATRIX_FORK_EPOCH * slotPerEpochRatio,
  CAPELLA_FORK_EPOCH: mainnetChainConfig.CAPELLA_FORK_EPOCH * slotPerEpochRatio,
  DENEB_FORK_EPOCH: mainnetChainConfig.DENEB_FORK_EPOCH * slotPerEpochRatio,
});
/* eslint-enable @typescript-eslint/naming-convention */

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
            blindedOrFullBlockToFull(config, forkInfo.seq, deserialized, transactionsAndWithdrawals);
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
            blindedOrFullBlockToBlinded(config, deserialized);
          },
        });

        itBench({
          id: `${forkInfo.name} to blinded - convert serialized`,
          fn: () => {
            blindedOrFullBlockToBlindedBytes(config, full, fullSerialized);
          },
        });
      });
    }
  });
});
