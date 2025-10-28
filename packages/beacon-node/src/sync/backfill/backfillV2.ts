import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {ByteVectorType} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks, computeAnchorCheckpoint} from "@lodestar/state-transition";
import {
  BeaconBlockHeader,
  Root,
  SignedBeaconBlock,
  SignedBeaconBlockHeader,
  Slot,
  WithBytes,
  fulu,
  phase0,
} from "@lodestar/types";
import {ErrorAborted, Logger, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../../network/index.js";
import {PeerSyncMeta} from "../../network/peers/peersData.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerIdStr} from "../../util/peerId.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.ts";
import {BackfillBlock, BackfillBlockHeader, verifyBlockProposerSignature, verifyBlockSequence} from "./verify.js";

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  anchorState: BeaconStateAllForks;
  wsCheckpoint?: phase0.Checkpoint;
  signal: AbortSignal;
};

type BackfillModules = BackfillSyncModules & {
  syncAnchor: BackFillSyncAnchor;
  backfillStartFromSlot: Slot;
  wsCheckpointHeader: BackfillBlockHeader | null;
};

export type BackfillSyncOpts = {
  backfillBatchSize: number;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncMethod {
  rangesync = "rangesync",
  blockbyroot = "blockbyroot",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
  aborted = "aborted",
}

type BackfillSyncEvents = {
  [BackfillSyncEvent.completed]: (oldestSlotSynced: Slot) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

// Assumptions:
//  BackfillBlock type exists purely as a convenience helper type to store a block along with its own root
//  lastBackSyncedBlock and anchorBlock are almost always the same, except some cases (ex: when BackfillSyncErrorCode.NOT_LINEAR)
type BackFillSyncAnchor =
  | {
      anchorBlockParentRoot: Root;
      anchorBlock: SignedBeaconBlock;
      anchorBlockRoot: Root;
      anchorSlot: Slot;
      lastBackSyncedBlock: BackfillBlock;
    }
  | {
      anchorBlockParentRoot: Root;
      anchorBlock: null;
      anchorBlockRoot: Root;
      anchorSlot: null;
      lastBackSyncedBlock: BackfillBlock;
    }
  | {
      anchorBlockParentRoot: Root;
      anchorBlock: null;
      anchorBlockRoot: Root;
      anchorSlot: Slot;
      lastBackSyncedBlock: null;
    };

// Updating peer score:
// We can update it on certain events, such as request fulfilled, batch successfully imported, response times.
type PeerBackfillSyncMeta = PeerSyncMeta & {
  score: number;
  // requestsInFlight: number; // rethink will it be really useful
  // For round-robin distribution
  lastSlotRequested: number;
  failedRequests: number;
  avgResTime: number;
};

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  syncAnchor: BackFillSyncAnchor;

  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;
  private opts: BackfillSyncOpts;
  private wsCheckpointHeader: BackfillBlockHeader | null;
  private backfillStartFromSlot: Slot;

  private processor = new ItTrigger();

  // TODO: Consider implementing more efficient data structures and explore using util fns from network.ts (getConnectedPeerSyncMeta, getConnectedPeers, etc.)
  // - Adding selectivity to peers: we already have earliestAvailableSlot via PeerSyncMeta,
  // For delegating batch requests to different peers, we have following considerations:
  // - distribute requests evnely to avoid overwhelming a peer (use round-robin, etc.)
  // - keep track of valid responses, upscore peer
  // - keep track of failed responses, downscore peer, disconnect over threshold
  // - grouping by earliestAvailableSlot value, a peer irrelevant now can be relevant in later stage of backfill
  // - explore if any other pruning reqd
  private peers = new Set<PeerIdStr>();
  // To store relevant, good quality peers.
  // Rethink about this data structure as we need to store peers sorted acc to score, peers could be ~100
  private peersMeta: Map<PeerIdStr, PeerBackfillSyncMeta>;
  // private peersSortedByScore: PeerIdStr[] = [];

  private status: BackfillSyncStatus = BackfillSyncStatus.pending;
  private signal: AbortSignal;

  constructor(opts: BackfillSyncOpts, modules: BackfillModules) {
    super();

    this.syncAnchor = modules.syncAnchor;
    this.backfillStartFromSlot = modules.backfillStartFromSlot;
    this.wsCheckpointHeader = modules.wsCheckpointHeader;

    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.peersMeta = new Map();

    this.opts = opts;
    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
    this.signal = modules.signal;

    this.sync()
      .then(() => {
        this.logger.info("BackfillSync completed");
        this.close();
      })
      .catch((e) => {
        this.logger.error("BackfillSync processor error", e);
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });
  }

  static async init<T extends BackfillSync = BackfillSync>(
    opts: BackfillSyncOpts,
    modules: BackfillSyncModules
  ): Promise<T> {
    const {config, anchorState, wsCheckpoint, logger} = modules;

    const {checkpoint: anchorCp} = computeAnchorCheckpoint(config, anchorState);
    const anchorBlockParentRoot = anchorState.latestBlockHeader.toValue().parentRoot;
    const anchorSlot = anchorState.latestBlockHeader.slot;
    // Assumptions: anchor is meant to be
    const syncAnchor = {
      anchorBlockParentRoot,
      anchorBlock: null,
      anchorBlockRoot: anchorCp.root, // this may help
      anchorSlot,
      lastBackSyncedBlock: null,
    };

    // ***************
    // Already present: anchorState, anchorCp.epoch, anchorCp.root, anchorSlot, wsCheckpoint
    // Might be present: anchorBlock
    // Must be present: anchorChildBlock

    const backfillStartFromSlot = anchorSlot;
    logger.info("Initializing from Checkpoint", {
      root: toRootHex(anchorCp.root),
      epoch: anchorCp.epoch,
      backfillStartFromSlot,
    });

    const wsCheckpointHeader: BackfillBlockHeader | null = wsCheckpoint
      ? {root: wsCheckpoint.root, slot: wsCheckpoint.epoch * SLOTS_PER_EPOCH}
      : null;

    return new BackfillSync(opts, {
      syncAnchor,
      backfillStartFromSlot, // syncAnchor.anchorSlot
      wsCheckpointHeader, // from checkpoint sync
      ...modules,
    }) as T;
  }

  private async sync(): Promise<void> {
    this.processor.trigger();

    this.logger.info("Starting BackfillSync.");
    let iterationCount = 0;

    for await (const _ of this.processor) {
      this.status = BackfillSyncStatus.syncing;
      // Mark: A
      // DEBUG_CODE
      iterationCount++;
      this.logger.info(
        "---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------"
      );
      this.logger.info("Iteration: ", iterationCount);
      this.logger.info(
        "---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------"
      );
      // DEBUG_CODE

      // DEBUG_CODE
      this.logger.info("Trying to do backfill sync", {
        iteration: iterationCount,
        totalPeers: this.peers.size,
        peersInMeta: this.peersMeta.size,
        currentRequiredSlot: this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot,
        signal: this.signal.aborted ? "aborted" : "active",
      });
      if (this.peers.size === 0) {
        this.logger.warn("No peers connected, waiting for peers...", {
          iteration: iterationCount,
        });
        // await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      // DEBUG_CODE

      try {
        // Select best peer
        const goodPeer: PeerIdStr = this.getGoodSyncPeer();

        if (!goodPeer) {
          this.logger.info("No eligible peer found for backfill", {
            iteration: iterationCount,
            totalPeers: this.peers.size,
            peersInMeta: this.peersMeta.size,
            currentRequiredSlot: this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot,
          });
          // DEBUG_CODE
          for (const [peerId, meta] of this.peersMeta.entries()) {
            this.logger.debug("Peer status", {
              peer: peerId,
              client: meta.client,
              connected: this.peers.has(peerId),
              score: meta.score,
              failedRequests: meta.failedRequests,
              lastSlotRequested: meta.lastSlotRequested,
              earliestAvailableSlot: meta.earliestAvailableSlot,
              avgResTime: meta.avgResTime,
              isConnected: this.peers.has(peerId),
            });
          }
          // DEBUG_CODE
          continue;
        }

        // biome-ignore lint/style/noNonNullAssertion: test
        const goodPeerMetaData: PeerBackfillSyncMeta = this.peersMeta.get(goodPeer)!;
        if (!goodPeerMetaData) {
          this.logger.error("Selected peer has no metadata (should not happen)", {
            peer: goodPeer,
          });
          throw Error("Selected peer has no metadata (should not happen)");
        }
        this.logger.info("Got a good peer to sync", {
          iteration: iterationCount,
          totalPeers: this.peers.size,
          peer: goodPeer,
          client: goodPeerMetaData?.client,
          earliestAvailableSlot: goodPeerMetaData?.earliestAvailableSlot,
          score: goodPeerMetaData?.score,
          lastSlotRequested: goodPeerMetaData?.lastSlotRequested,
          failedRequests: goodPeerMetaData?.failedRequests,
          avgResTime: goodPeerMetaData?.avgResTime,
          custodyColumns: prettyPrintIndices(goodPeerMetaData?.custodyColumns),
        });
        // Mark: B

        const currRequiredSlot = this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot;
        const batchSize = this.opts.backfillBatchSize;
        const batchStartSlot = Math.max(0, currRequiredSlot - batchSize);
        // Flow:
        // send beacon_blocks_by_range request
        // validate blocks
        // store blocks in db blockarchive
        // update lastBackSyncedBlock
        // update BackfillRange and BackfillState
        // update earliestAvailableSlot

        const req: phase0.BeaconBlocksByRangeRequest = {
          startSlot: batchStartSlot,
          count: batchSize,
          step: 1,
        };
        let res: WithBytes<SignedBeaconBlock>[] = [];
        try {
          // req = {
          //   startSlot: batchStartSlot,
          //   count: batchSize,
          //   step: 1,
          // };
          // DEBUG_CODE
          this.logger.info("Sending BeaconBlocksByRange request", {
            iteration: iterationCount,
            peer: goodPeer,
            client: goodPeerMetaData?.client,
            startSlot: req.startSlot,
            count: req.count,
            endSlot: batchStartSlot + batchSize - 1,
            currRequiredSlot,
            lastBackSyncedBlockSlot: this.syncAnchor.lastBackSyncedBlock?.slot,
            backfillStartFromSlot: this.backfillStartFromSlot,
          });
          // DEBUG_CODE

          const startTime = Date.now();
          res = await this.network.sendBeaconBlocksByRange(goodPeer, req);
          const resTime = Date.now() - startTime;
          this.logger.info("Got response to beacon_blocks_by_range request. Received blocks: ", {
            // resDetails:
            iteration: iterationCount,
            resTimeMs: resTime,
            blocksReceived: res.length,
            startSlot: req.startSlot,
            endSlot: req.startSlot + req.count - 1,
            // peerDetails:
            peer: goodPeer,
            client: goodPeerMetaData?.client,
            peerScore: goodPeerMetaData?.score,
            peerLastSlotRequested: goodPeerMetaData?.lastSlotRequested,
            peerFailedRequests: goodPeerMetaData?.failedRequests,
            avgResTime: goodPeerMetaData?.avgResTime,
          });

          // Mark: C

          // DEBUG_CODE
          // Log first and last block details
          if (res.length > 0) {
            this.logger.info("Batch block details", {
              firstBlockSlot: res[0].data.message.slot,
              // biome-ignore lint/style/useAtIndex: this is correct
              lastBlockSlot: res[res.length - 1].data.message.slot,
              totalBlocks: res.length,
            });
          } else {
            this.logger.error("Empty blocks response", {
              peer: goodPeer,
              ...req,
            });
            throw Error("Empty blocks response");
          }
          // DEBUG_CODE

          // Update metadata
          const updatedResTime =
            goodPeerMetaData.avgResTime === 0 ? resTime : 0.7 * goodPeerMetaData.avgResTime + 0.3 * resTime; // Exponentially Weighted Moving Average. TODO: reconsider fractional params
          const updatedMeta: PeerBackfillSyncMeta = {
            ...goodPeerMetaData,
            score: goodPeerMetaData?.score + 1,
            lastSlotRequested: req.startSlot,
            // failedRequests::0, // reset on success
            avgResTime: updatedResTime,
          };
          this.peersMeta.set(goodPeer, updatedMeta);

          // DEBUG_CODE
          this.logger.info("Peer metadata updated after success", {
            peer: goodPeer,
            client: updatedMeta.client,
            newScore: updatedMeta.score,
            newLastSlotRequested: updatedMeta.lastSlotRequested,
            thisResponseTimeMs: resTime,
            newAvgResTime: updatedMeta.avgResTime,
          });
          // DEBUG_CODE
        } catch (resErr) {
          this.logger.error("Error in beacon_blocks_by_range request. Error msg: ", {
            iteration: iterationCount,
            peer: goodPeer,
            client: goodPeerMetaData?.client,
            error: (resErr as Error).message,
            stack: (resErr as Error).stack,
            // reqDetails:
            startSlot: req.startSlot,
            count: req.count,
            endSlot: batchStartSlot + batchSize - 1,
            lastBackSyncedBlockSlot: this.syncAnchor.lastBackSyncedBlock?.slot,
            backfillStartFromSlot: this.backfillStartFromSlot,
          });
          // Update Metadata
          const updatedMeta: PeerBackfillSyncMeta = {
            ...goodPeerMetaData,
            score: goodPeerMetaData.score - 1,
            failedRequests: goodPeerMetaData.failedRequests + 1,
          };
          this.peersMeta.set(goodPeer, updatedMeta);

          // DEBUG_CODE
          this.logger.warn("Peer metadata updated after failure", {
            peer: goodPeer,
            newScore: updatedMeta.score,
            failedRequests: updatedMeta.failedRequests,
            consecutiveFailures: updatedMeta.failedRequests,
          });
          // DEBUG_CODE

          if (updatedMeta.failedRequests >= 5) {
            // DEBUG_CODE
            this.logger.warn("Peer exceeded failure threshold, removing", {
              peer: goodPeer,
              client: updatedMeta.client,
              failedRequests: updatedMeta.failedRequests,
            });
            // DEBUG_CODE
            this.network.reportPeer(goodPeer, PeerAction.MidToleranceError, "backfill_repeated_failure");
            this.peers.delete(goodPeer);
            this.peersMeta.delete(goodPeer);
          }
          // rethrow to avoid further actions
          throw Error("Error getting blocks by range from peer.");
        }
        // Mark: D

        // Validate, Update State and Persist
        // Mark: E

        try {
          const anchorParentRoot = this.syncAnchor.anchorBlockParentRoot;
          // Note that blocks in res are in reverse order
          const {nextAnchor, verifiedBlocks /* , error */} = verifyBlockSequence(this.config, res, anchorParentRoot);
          // Mark: F
          if (!nextAnchor || verifiedBlocks?.length === 0) throw Error("Didn't receive nextAnchor. Retry!");
          this.logger.info("Verified Block Sequence", {
            nextAnchor: nextAnchor?.slot,
            verifiedBlocks: verifiedBlocks?.length,
            firstBlockSlot: res[0].data.message.slot,
            // biome-ignore lint/style/useAtIndex: this is correct
            lastBlockSlot: res[res?.length - 1].data.message.slot,
            verifiedBlocksStart: verifiedBlocks[0].data.message.slot,
            // biome-ignore lint/style/useAtIndex: this is correct
            verifiedBlocksEnd: verifiedBlocks[verifiedBlocks.length - 1].data.message.slot,
            // error: error,
          });

          await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), verifiedBlocks);
          this.logger.info("Verified Block Proposer Signatures.");

          // Mark: G
          // Store in db: blockarchive in the format: KeyValue<Slot, SignedBeaconBlock>[]
          try {
            await this.db.blockArchive.batchPutBinary(
              verifiedBlocks.map((block) => ({
                key: block.data.message.slot,
                value: block.bytes,
                slot: block.data.message.slot,
                blockRoot: this.config
                  .getForkTypes(block.data.message.slot)
                  .BeaconBlock.hashTreeRoot(block.data.message),
                parentRoot: block.data.message.parentRoot,
              }))
            );
          } catch (error) {
            this.logger.error("Error storing backfill batch to db.", {
              firstBlockSlot: verifiedBlocks[0].data.message.slot,
              // biome-ignore lint/style/useAtIndex: this is correct
              lastBlockSlot: verifiedBlocks[verifiedBlocks?.length - 1].data.message.slot,
            });
            throw error as Error;
          }

          // Update lastBackSyncedBlock
          this.syncAnchor = {
            lastBackSyncedBlock: nextAnchor,
            anchorBlock: nextAnchor?.block,
            anchorBlockParentRoot: nextAnchor?.block.message.parentRoot,
            anchorBlockRoot: nextAnchor?.root,
            anchorSlot: nextAnchor?.slot,
          };

          // Mark: H
          // Todo: update db singleton object: BackfillRange and BackfillState
          // Todo: Think about how to initialize these on node startup
          // Todo: update earliestAvailableSlot
          // Mark: I
        } catch (validErr) {
          this.logger.error("Block Sequence verification failed", {
            anchorBlockSlot: this.syncAnchor.anchorSlot,
            anchorParentRoot: this.syncAnchor.anchorBlockParentRoot.toString(),
            firstBlockSlot: res[0]?.data.message.slot,
            // biome-ignore lint/style/useAtIndex: this is correct
            lastBlockSlot: res[res?.length - 1]?.data.message.slot,
            blockSequenceLength: res?.length,
            error: (validErr as Error).message,
            stack: (validErr as Error).stack,
          });
        }

        // this.backfillStartFromSlot = batchStartSlot; // -1
      } catch (error) {
        this.logger.error("Caught Error: ", {
          error: (error as Error).message,
          errorStack: (error as Error).stack,
        });
        // if (error instanceof BackfillSyncError) {
        //   switch (error.type.code) {
        //     // case BackfillSyncErrorCode.INTERNAL_ERROR:
        //     //   // Break it out of the loop and throw error
        //     //   this.status = BackfillSyncStatus.aborted;
        //     //   break;
        //     // case BackfillSyncErrorCode.NOT_ANCHORED:
        //     // // biome-ignore lint/suspicious/noFallthroughSwitchClause: We need fall-through behavior here
        //     // case BackfillSyncErrorCode.NOT_LINEAR:
        //     //   // Lets try to jump directly to the parent of this anchorBlock as previous
        //     //   // (segment) of blocks could be orphaned/missed
        //     //   if (this.syncAnchor.anchorBlock) {
        //     //     this.syncAnchor = {
        //     //       anchorBlock: null,
        //     //       anchorBlockRoot: this.syncAnchor.anchorBlock.message.parentRoot,
        //     //       anchorSlot: null,
        //     //       lastBackSyncedBlock: this.syncAnchor.lastBackSyncedBlock,
        //     //     };
        //     //   }

        //     //     // falls through
        //     case BackfillSyncErrorCode.INVALID_SIGNATURE:
        //       this.network.reportPeer("goodPeer", PeerAction.LowToleranceError, "BadSyncBlocks");
        //   }
        // }
      } finally {
        // if (this.status !== BackfillSyncStatus.aborted) this.processor.trigger(); ?
        // sleep for sometime
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // DEBUG_CODE
    this.logger.info("BackfillSync loop ended", {
      status: this.status,
      // finalSlot: this.backfillStartFromSlot, ?
    });
    // DEBUG_CODE
    // throw new ErrorAborted("BackfillSync");
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  private addPeer = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    // TODO: use db singleton object: BackfillRange to get requiredSlot
    const requiredSlot = this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot;

    // DEBUG_CODE
    // this.logger.info("Add peer bf:", {ourpeerhead: data.status.headSlot, requiredSlot});
    // DEBUG_CODE

    const peerMetaData = this.network.getConnectedPeerSyncMeta(data.peer);
    const earliestAvailableSlot = (data.status as fulu.Status).earliestAvailableSlot;

    // Reconsider logic for earliestAvailableSlot value, a peer irrelevant now can be relevant in later stage of backfill.
    // Assuming short lived connections for now, and hence ignoring above comment.
    if (data.status.headSlot < requiredSlot) {
      // DEBUG_CODE
      this.logger.warn("Peer head too far behind", {
        // we cant trust this peer
        peer: data.peer,
        peerHead: data.status.headSlot,
        requiredSlot,
      });
      // DEBUG_CODE
      return;
    }
    // ignore irrelevant peers
    if (peerMetaData.earliestAvailableSlot !== undefined && peerMetaData.earliestAvailableSlot > requiredSlot) {
      // DEBUG_CODE
      this.logger.warn("Peer doesn't have required historical data", {
        peer: data.peer,
        earliestAvailableSlot,
        requiredSlot,
      });
      // DEBUG_CODE
      return;
    }

    // Add peer
    if (!this.peers.has(data.peer)) {
      this.peers.add(data.peer);
      this.peersMeta.set(data.peer, {
        ...peerMetaData,
        score: 0,
        lastSlotRequested: 0, // 0 default value
        failedRequests: 0,
        avgResTime: 0,
      });
      // DEBUG_CODE
      // this.logger.info("Backfill peer added", {
      //   peer: data.peer,
      //   client: peerMetaData?.client,
      //   totalPeers: this.peers.size,
      //   earliestAvailableSlot,
      // });
      // DEBUG_CODE
    } else {
      const existingMetaData = this.peersMeta.get(data.peer);
      if (existingMetaData) {
        // update metadata if already present
        this.peersMeta.set(data.peer, {
          ...existingMetaData,
          ...peerMetaData,
        });
        // DEBUG_CODE
        // this.logger.info("Backfill peer re-statused", {
        //   peer: data.peer,
        //   client: peerMetaData?.client,
        //   totalPeers: this.peers.size,
        //   earliestAvailableSlot,
        //   score: existingMetaData.score,
        //   lastSlotRequested: existingMetaData.lastSlotRequested,
        //   failedRequests: existingMetaData.failedRequests,
        //   avgResTime: existingMetaData.avgResTime,
        //   custodyColumns: prettyPrintIndices(goodPeerMetaData?.custodyColumns),
        // });
        // DEBUG_CODE
      }
    }
    this.processor.trigger();
  };

  private removePeer = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    // DEBUG_CODE
    // const meta = this.peersMeta.get(data.peer);
    // this.logger.info("Backfill peer disconnected", {
    //   peer: data.peer,
    //   client: meta?.client,
    //   score: meta?.score,
    //   failedRequests: meta?.failedRequests,
    //   lastSlotRequested: meta?.lastSlotRequested,
    // });
    // DEBUG_CODE
    this.peers.delete(data.peer);
    // need to remove metadata to maintain less selectivity and fair chance, or else cumulative downscoring/upscoring may lead to very high selectivity
    this.peersMeta.delete(data.peer);
  };

  // TODO: fix this inefficient impl in future
  // return weighted random peer
  private getGoodSyncPeer = (): PeerIdStr => {
    const eligiblePeers: PeerIdStr[] = [];
    // TODO: use db singleton object: BackfillRange to get requiredSlot
    const currRequiredSlot = this.syncAnchor.lastBackSyncedBlock?.slot ?? this.backfillStartFromSlot;

    // DEBUG_CODE
    // this.logger.info("Selecting peer for backfill", {
    //   currRequiredSlot,
    //   totalPeersConnected: this.peers.size,
    //   totalPeersInMeta: this.peersMeta.size,
    // });
    // DEBUG_CODE

    for (const [peerId, meta] of this.peersMeta.entries()) {
      // if metadata present but currently not connected
      if (!this.peers.has(peerId)) {
        continue;
      }
      if (meta.failedRequests >= 3) {
        // DEBUG_CODE
        // this.logger.warn("Skipping peer with too many failures", {
        //   peerId,
        //   client: meta.client,
        //   failedRequests: meta.failedRequests,
        // });
        // DEBUG_CODE
        continue;
      }
      if (meta.earliestAvailableSlot !== undefined && meta.earliestAvailableSlot > currRequiredSlot) {
        // DEBUG_CODE
        // this.logger.warn("Skipping peer without reqd data", {
        //   peerId,
        //   earliestAvailableSlot: meta.earliestAvailableSlot,
        //   currRequiredSlot,
        // });
        // DEBUG_CODE
        continue;
      }
      // if lastSlotRequest is very recent
      if (
        meta.lastSlotRequested !== 0 &&
        Math.abs(meta.lastSlotRequested - currRequiredSlot) < this.opts.backfillBatchSize
      ) {
        // DEBUG_CODE
        // this.logger.info("Skipping recently used peer", {
        //   peerId,
        //   lastSlotRequested: meta.lastSlotRequested,
        //   currRequiredSlot,
        // });
        // DEBUG_CODE
        continue;
      }
      eligiblePeers.push(peerId);
    }

    if (eligiblePeers.length === 0) {
      this.logger.warn("No eligible peers for backfill", {
        totalPeers: this.peers.size,
        currRequiredSlot,
      });
      // throw to catch in sync loop
      // throw Error("No eligible peers for backfill");
      return "";
    }

    eligiblePeers.sort((a, b) => {
      const metaA = this.peersMeta.get(a);
      const metaB = this.peersMeta.get(b);
      if (!metaA || !metaB) {
        return 0;
      }
      // sort peers according to score
      if (Math.abs(metaA.score - metaB.score) > 10) {
        return metaB.score - metaA.score;
      }
      // if difference within 10 points, choose last recently used
      return metaB.lastSlotRequested - metaA.lastSlotRequested;
    });
    return eligiblePeers[0];
  };
}
