import {AbortController} from "abort-controller";
import {config} from "@chainsafe/lodestar-config/minimal";
import {Epoch, phase0, Slot} from "@chainsafe/lodestar-types";
import {linspace} from "../../../../src/util/numpy";
import {generateEmptyBlock, generateEmptySignedBlock} from "../../../utils/block";
import {testLogger} from "../../../utils/logger";
import {getValidPeerId} from "../../../utils/peer";
import {
  SyncChain,
  SyncChainOpts,
  ProcessChainSegment,
  DownloadBeaconBlocksByRange,
  GetPeersAndTargetEpoch,
} from "../../../../src/sync/range/chain";

describe("sync / range / chain", () => {
  const {SLOTS_PER_EPOCH} = config.params;

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
  const controller = new AbortController();
  const ACCEPT_BLOCK = Buffer.alloc(96, 0);
  const REJECT_BLOCK = Buffer.alloc(96, 1);
  const interval: NodeJS.Timeout | null = null;

  afterEach(() => {
    if (interval) clearInterval(interval);
  });

  for (const {id, startEpoch, targetEpoch, badBlocks, skippedSlots} of testCases) {
    it(id, async () => {
      const processChainSegment: ProcessChainSegment = async (blocks) => {
        for (const block of blocks) {
          if (block.signature === ACCEPT_BLOCK) continue;
          if (block.signature === REJECT_BLOCK) throw Error("REJECT_BLOCK");
        }
      };

      const downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async (peerId, request) => {
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

      const peers = [peer];
      const getPeerSet: GetPeersAndTargetEpoch = () => {
        return {
          peers,
          targetEpoch,
        };
      };

      const initialSync = new SyncChain(
        startEpoch,
        processChainSegment,
        downloadBeaconBlocksByRange,
        getPeerSet,
        config,
        logger,
        controller.signal
      );

      await initialSync.sync();
    });
  }

  it("Should start with no peers, then sync to target", async () => {
    const opts: SyncChainOpts = {epochsPerBatch: 2, maybeStuckTimeoutMs: 5};
    const startEpoch = 0;
    const targetEpoch = 16;
    const peers = [peer];
    let returnNoPeers = true;

    setTimeout(() => {
      returnNoPeers = false;
    }, 20);

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const processChainSegment: ProcessChainSegment = async () => {};
    const downloadBeaconBlocksByRange: DownloadBeaconBlocksByRange = async () => [generateEmptySignedBlock()];
    const getPeerSet: GetPeersAndTargetEpoch = () => (returnNoPeers ? null : {peers, targetEpoch});

    const initialSync = new SyncChain(
      startEpoch,
      processChainSegment,
      downloadBeaconBlocksByRange,
      getPeerSet,
      config,
      logger,
      controller.signal,
      opts
    );

    await initialSync.sync();
  });
});
