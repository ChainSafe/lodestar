import {config} from "@lodestar/config/default";
import {Logger} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Epoch, phase0, Slot, ssz} from "@lodestar/types";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {linspace} from "../../../../src/util/numpy.js";
import {SyncChain, SyncChainFns, ChainTarget} from "../../../../src/sync/range/chain.js";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType.js";
import {ZERO_HASH} from "../../../../src/constants/index.js";
import {testLogger} from "../../../utils/logger.js";
import {getValidPeerId} from "../../../utils/peer.js";
import {BlockInput, getBlockInput} from "../../../../src/chain/blocks/types.js";

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
      id: "Simulate sync with a very long range of skipped slots",
      startEpoch: 0,
      targetEpoch: 16,
      skippedSlots: new Set(linspace(3 * SLOTS_PER_EPOCH, 10 * SLOTS_PER_EPOCH)),
    },
    {
      id: "Simulate sync with multiple ranges of bad blocks",
      startEpoch: 0,
      targetEpoch: 16,
      badBlocks: new Set(linspace(3 * SLOTS_PER_EPOCH, 10 * SLOTS_PER_EPOCH)),
    },
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
  const peer = getValidPeerId();
  const logger = testLogger();
  const ACCEPT_BLOCK = Buffer.alloc(96, 0);
  const REJECT_BLOCK = Buffer.alloc(96, 1);
  const zeroBlockBody = ssz.phase0.BeaconBlockBody.defaultValue();
  const interval: NodeJS.Timeout | null = null;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reportPeer: SyncChainFns["reportPeer"] = () => {};

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

      const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peerId, request) => {
        const blocks: BlockInput[] = [];
        for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
          if (skippedSlots?.has(i)) {
            continue; // Skip
          }

          // Only reject once to prevent an infinite loop
          const shouldReject = badBlocks?.has(i);
          if (shouldReject) badBlocks?.delete(i);
          blocks.push(
            getBlockInput.preDeneb(config, {
              message: generateEmptyBlock(i),
              signature: shouldReject ? REJECT_BLOCK : ACCEPT_BLOCK,
            })
          );
        }
        return blocks;
      };

      const target: ChainTarget = {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH};
      const syncType = RangeSyncType.Finalized;

      await new Promise<void>((resolve, reject) => {
        const onEnd: SyncChainFns["onEnd"] = (err) => (err ? reject(err) : resolve());
        const initialSync = new SyncChain(
          startEpoch,
          target,
          syncType,
          logSyncChainFns(logger, {processChainSegment, downloadBeaconBlocksByRange, reportPeer, onEnd}),
          {config, logger}
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

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const processChainSegment: SyncChainFns["processChainSegment"] = async () => {};
    const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peer, request) => {
      const blocks: BlockInput[] = [];
      for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
        blocks.push(
          getBlockInput.preDeneb(config, {
            message: generateEmptyBlock(i),
            signature: ACCEPT_BLOCK,
          })
        );
      }
      return blocks;
    };

    const target: ChainTarget = {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH};
    const syncType = RangeSyncType.Finalized;

    await new Promise<void>((resolve, reject) => {
      const onEnd: SyncChainFns["onEnd"] = (err) => (err ? reject(err) : resolve());
      const initialSync = new SyncChain(
        startEpoch,
        target,
        syncType,
        logSyncChainFns(logger, {processChainSegment, downloadBeaconBlocksByRange, reportPeer, onEnd}),
        {config, logger}
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
    downloadBeaconBlocksByRange(peer, request) {
      logger.debug("mock downloadBeaconBlocksByRange", request);
      return fns.downloadBeaconBlocksByRange(peer, request);
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
