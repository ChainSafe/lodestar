import {config} from "@chainsafe/lodestar-config/default";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {Epoch, phase0, Slot} from "@chainsafe/lodestar-types";
import {linspace} from "../../../../src/util/numpy";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {SyncChain, SyncChainFns, ChainTarget} from "../../../../src/sync/range/chain";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {RangeSyncType} from "../../../../src/sync/utils/remoteSyncType";
import {ZERO_HASH} from "../../../../src/constants";
import {testLogger} from "../../../utils/logger";
import {getValidPeerId} from "../../../utils/peer";

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
      id: "Simulate sync that must be completed immediatelly",
      startEpoch: 20,
      targetEpoch: 16,
    },
  ];

  // Helper variables to trigger errors
  const peer = getValidPeerId();
  const logger = testLogger();
  const ACCEPT_BLOCK = Buffer.alloc(96, 0);
  const REJECT_BLOCK = Buffer.alloc(96, 1);
  const interval: NodeJS.Timeout | null = null;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reportPeer: SyncChainFns["reportPeer"] = () => {};

  afterEach(() => {
    if (interval !== null) clearInterval(interval);
  });

  for (const {id, startEpoch, targetEpoch, badBlocks, skippedSlots} of testCases) {
    it(id, async () => {
      const processChainSegment: SyncChainFns["processChainSegment"] = async (blocks) => {
        for (const block of blocks) {
          if (block.signature === ACCEPT_BLOCK) continue;
          if (block.signature === REJECT_BLOCK) throw Error("REJECT_BLOCK");
        }
      };

      const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peerId, request) => {
        const blocks: phase0.SignedBeaconBlock[] = [];
        for (let i = request.startSlot; i < request.startSlot + request.count; i += request.step) {
          if (skippedSlots?.has(i)) {
            continue; // Skip
          }

          // Only reject once to prevent an infinite loop
          const shouldReject = badBlocks?.has(i);
          if (shouldReject) badBlocks?.delete(i);
          blocks.push({
            message: generateEmptyBlock(),
            signature: shouldReject ? REJECT_BLOCK : ACCEPT_BLOCK,
          });
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
          {processChainSegment, downloadBeaconBlocksByRange, reportPeer, onEnd},
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
    const downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async () => [
      generateEmptySignedBlock(),
    ];

    const target: ChainTarget = {slot: computeStartSlotAtEpoch(targetEpoch), root: ZERO_HASH};
    const syncType = RangeSyncType.Finalized;

    await new Promise<void>((resolve, reject) => {
      const onEnd: SyncChainFns["onEnd"] = (err) => (err ? reject(err) : resolve());
      const initialSync = new SyncChain(
        startEpoch,
        target,
        syncType,
        {processChainSegment, downloadBeaconBlocksByRange, reportPeer, onEnd},
        {config, logger}
      );

      // Add peers after some time
      setTimeout(() => {
        for (const peer of peers) initialSync.addPeer(peer, target);
      }, 20);

      initialSync.startSyncing(startEpoch);
    });
  });
});
