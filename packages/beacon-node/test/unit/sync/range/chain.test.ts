import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, Slot, phase0, ssz} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {afterEach, describe, it} from "vitest";
import {BlockInput, BlockSource, getBlockInput} from "../../../../src/chain/blocks/types.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {ChainTarget, SyncChain, SyncChainFns} from "../../../../src/sync/range/chain.js";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType.js";
import {CustodyConfig} from "../../../../src/util/dataColumns.js";
import {linspace} from "../../../../src/util/numpy.js";
import {testLogger} from "../../../utils/logger.js";
import {validPeerIdStr} from "../../../utils/peer.js";

describe("sync / range / chain", () => {
  const testCases: {
    id: string;
    startEpoch: Epoch;
    targetEpoch: Epoch;
    badBlocks?: Set<Slot>;
    skippedSlots?: Set<Slot>;
  }[] = [
    {
      id: "Simulate sync with no issues",
      startEpoch: 0,
      targetEpoch: 16,
    },
    {
      // due to BATCH_BUFFER_SIZE and MAX_LOOK_AHEAD_EPOCHS, lodestar cannot deal with unlimited skipped slots
      // having a test with 2 epochs of skipped slots is enough to test the logic
      // this hasn't happened in any networks as of Aug 2025
      id: "Simulate sync with 2 epochs of skipped slots",
      startEpoch: 0,
      targetEpoch: 16,
      skippedSlots: new Set(linspace(3 * SLOTS_PER_EPOCH, 4 * SLOTS_PER_EPOCH)),
    },
    // As of https://github.com/ChainSafe/lodestar/pull/8150, we abort the batch after a single processing error
    // {
    //   id: "Simulate sync with multiple ranges of bad blocks",
    //   startEpoch: 0,
    //   targetEpoch: 16,
    //   badBlocks: new Set(linspace(3 * SLOTS_PER_EPOCH, 10 * SLOTS_PER_EPOCH)),
    // },
    {
      id: "Simulate sync when right on genesis epoch",
      startEpoch: 0,
      targetEpoch: 0,
    },
    {
      id: "Simulate sync that must be completed immediately",
      startEpoch: 20,
      targetEpoch: 16,
    },
  ];

  // Helper variables to trigger errors
  const peer = validPeerIdStr;
  const logger = testLogger();
  const ACCEPT_BLOCK = Buffer.alloc(96, 0);
  const REJECT_BLOCK = Buffer.alloc(96, 1);
  const zeroBlockBody = ssz.phase0.BeaconBlockBody.defaultValue();
  const interval: NodeJS.Timeout | null = null;
  const nodeId = fromHex("cdbee32dc3c50e9711d22be5565c7e44ff6108af663b2dc5abd2df573d2fa83f");
  const custodyConfig = new CustodyConfig({
    nodeId,
    config,
  });

  const reportPeer: SyncChainFns["reportPeer"] = () => {};
  const getConnectedPeerSyncMeta: SyncChainFns["getConnectedPeerSyncMeta"] = (peerId) => {
    return {
      peerId,
      client: "CLIENT_AGENT",
      custodyGroups: [],
    };
  };

  afterEach(() => {
    if (interval !== null) clearInterval(interval);
  });

  for (const {id, startEpoch, targetEpoch, badBlocks, skippedSlots} of testCases) {
    it(id, async () => {
      const processChainSegment: SyncChainFns["processChainSegment"] = async (blocks) => {
        for (const {block} of blocks) {
          if (block.signature === ACCEPT_BLOCK) continue;
          if (block.signature === REJECT_BLOCK) throw Error("REJECT_BLOCK");
        }
      };

      const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (
        _peer,
        request,
        _partialDownload
      ) => {
        const blocks: BlockInput[] = [];
        for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
          if (skippedSlots?.has(i)) {
            continue; // Skip
          }

          // Only reject once to prevent an infinite loop
          const shouldReject = badBlocks?.has(i);
          if (shouldReject) badBlocks?.delete(i);
          blocks.push(
            getBlockInput.preData(
              config,
              {
                message: generateEmptyBlock(i),
                signature: shouldReject ? REJECT_BLOCK : ACCEPT_BLOCK,
              },
              BlockSource.byRange
            )
          );
        }
        return {blocks, pendingDataColumns: null};
      };

      const target: ChainTarget = {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH};
      const syncType = RangeSyncType.Finalized;

      await new Promise<void>((resolve, reject) => {
        const onEnd: SyncChainFns["onEnd"] = (err) => (err ? reject(err) : resolve());
        const initialSync = new SyncChain(
          startEpoch,
          target,
          syncType,
          logSyncChainFns(logger, {
            processChainSegment,
            downloadBeaconBlocksByRange,
            getConnectedPeerSyncMeta,
            reportPeer,
            onEnd,
          }),
          {config, logger, custodyConfig, metrics: null}
        );

        const peers = [peer];
        for (const peer of peers) initialSync.addPeer(peer, target);

        initialSync.startSyncing(startEpoch);
      });
    });
  }

  it("Should start with no peers, then sync to target", async () => {
    const startEpoch = 0;
    const targetEpoch = 16;
    const peers = [peer];

    const processChainSegment: SyncChainFns["processChainSegment"] = async () => {};
    const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (
      _peer,
      request,
      _partialDownload
    ) => {
      const blocks: BlockInput[] = [];
      for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
        blocks.push(
          getBlockInput.preData(
            config,
            {
              message: generateEmptyBlock(i),
              signature: ACCEPT_BLOCK,
            },
            BlockSource.byRange
          )
        );
      }
      return {blocks, pendingDataColumns: null};
    };

    const target: ChainTarget = {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH};
    const syncType = RangeSyncType.Finalized;

    await new Promise<void>((resolve, reject) => {
      const onEnd: SyncChainFns["onEnd"] = (err) => (err ? reject(err) : resolve());
      const initialSync = new SyncChain(
        startEpoch,
        target,
        syncType,
        logSyncChainFns(logger, {
          processChainSegment,
          downloadBeaconBlocksByRange,
          reportPeer,
          getConnectedPeerSyncMeta,
          onEnd,
        }),
        {config, logger, custodyConfig, metrics: null}
      );

      // Add peers after some time
      setTimeout(() => {
        for (const peer of peers) initialSync.addPeer(peer, target);
      }, 20);

      initialSync.startSyncing(startEpoch);
    });
  });

  function generateEmptyBlock(slot: Slot): phase0.BeaconBlock {
    return {
      slot,
      proposerIndex: 0,
      parentRoot: Buffer.alloc(32),
      stateRoot: ZERO_HASH,
      body: zeroBlockBody,
    };
  }
});

function logSyncChainFns(logger: Logger, fns: SyncChainFns): SyncChainFns {
  return {
    processChainSegment(blocks, syncType) {
      logger.debug("mock processChainSegment", {blocks: blocks.map((b) => b.block.message.slot).join(",")});
      return fns.processChainSegment(blocks, syncType);
    },
    downloadBeaconBlocksByRange(peer, request, _partialDownload) {
      logger.debug("mock downloadBeaconBlocksByRange", request);
      return fns.downloadBeaconBlocksByRange(peer, request, _partialDownload);
    },
    getConnectedPeerSyncMeta(peerId) {
      logger.debug("mock getConnectedPeerSyncMeta", peerId);
      return fns.getConnectedPeerSyncMeta(peerId);
    },
    reportPeer(peer, action, actionName) {
      logger.debug("mock reportPeer", {peer: peer.toString(), action, actionName});
      return fns.reportPeer(peer, action, actionName);
    },
    onEnd(err, target) {
      logger.debug("mock onEnd", {target: target?.slot}, err ?? undefined);
      return fns.onEnd(err, target);
    },
  };
}
