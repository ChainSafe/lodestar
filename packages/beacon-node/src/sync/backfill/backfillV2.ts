import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {ByteVectorType} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateAllForks,
  computeAnchorCheckpoint,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  isStartSlotOfEpoch,
} from "@lodestar/state-transition";
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
import {ErrorAborted, Logger, prettyPrintIndices, sleep, toHex, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {BackfillState, EpochBackfillState} from "../../db/repositories/backfillState.ts";
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
  forceCheckpointSync?: boolean;
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
type PeerBackfillSyncMeta =
  | (PeerSyncMeta & {
      score: number;
      // requestsInFlight: number; // rethink will it be really useful
      // For round-robin distribution
      lastSlotRequested: number; // change to lastEpochRequested and adapt usage accordingly
      failedRequests: number;
      avgResTime: number;
    })
  | null;

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
  private nextRangeToSkip: {start: Slot; end: Slot} | null = null; // stores the immediate previous gap in backfill DB

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

  private readonly MAX_RETRY_ATTEMPTS_FOR_EMPTY_RESPONSE = 3;
  private currentAttempt = 1;

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
        this.logger.error("BackfillSync processor error", (e as Error).toString());
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });
  }

  static async init<T extends BackfillSync = BackfillSync>(
    opts: BackfillSyncOpts,
    modules: BackfillSyncModules
  ): Promise<T> {
    const {config, anchorState, wsCheckpoint, logger} = modules;

    const prevBackfillRange = await modules.db.backfillRange.get();

    let syncAnchor: BackFillSyncAnchor;

    const isForcedCheckpointSync: boolean = opts.forceCheckpointSync ?? false;

    if (prevBackfillRange && !isForcedCheckpointSync) {
      // the beggining and ending epoch slots must be in blockarchive.
      // beginningEpoch is always greater than endingEpoch
      const anchorBlock = await modules.db.blockArchive.get(computeStartSlotAtEpoch(prevBackfillRange.endingEpoch));
      const anchorChildBlock = await modules.db.blockArchive.get(
        computeStartSlotAtEpoch(prevBackfillRange.endingEpoch) + 1
      );

      if (anchorBlock) {
        modules.logger.info("Got prevBackfillRange from db, using it to set anchor block: ", {...prevBackfillRange});
        const blockRoot = modules.config
          .getForkTypes(anchorBlock.message.slot)
          .BeaconBlock.hashTreeRoot(anchorBlock.message);
        syncAnchor = {
          anchorBlockParentRoot: anchorBlock?.message.parentRoot,
          anchorBlock,
          anchorBlockRoot: blockRoot, // this may help
          anchorSlot: anchorBlock?.message.slot,
          lastBackSyncedBlock: {slot: anchorBlock.message.slot, root: blockRoot, block: anchorBlock},
        };
      }
      // Todo: Review this handling placement and when multiple consecutive blocks are missed
      // Do not rewrite backfill states while handling missed slot
      else if (anchorChildBlock) {
        modules.logger.warn("Missed Slot. Using anchorChildBlock to init syncAnchor.");
        modules.logger.info("Got prevBackfillRange from db, using it to set anchor block: ", {...prevBackfillRange});
        const blockRoot = modules.config
          .getForkTypes(anchorChildBlock.message.slot)
          .BeaconBlock.hashTreeRoot(anchorChildBlock.message);
        syncAnchor = {
          anchorBlockParentRoot: anchorChildBlock?.message.parentRoot,
          anchorBlock: anchorChildBlock,
          anchorBlockRoot: blockRoot, // this may help
          anchorSlot: anchorChildBlock?.message.slot,
          lastBackSyncedBlock: {slot: anchorChildBlock.message.slot, root: blockRoot, block: anchorChildBlock},
        };
      } else {
        // handle more gracefully, most prob by resetting the backfillrange using anchorState
        // throw Error("Invalid prevBackfillRange in db.");
        modules.logger.error("Invalid prevBackfillRange in db. Reinitializing backfill states using anchorState.");
        // use anchor from modules
        const {checkpoint: anchorCp} = computeAnchorCheckpoint(config, anchorState);
        const anchorBlockParentRoot = anchorState.latestBlockHeader.toValue().parentRoot;
        const anchorSlot = anchorState.latestBlockHeader.slot;
        syncAnchor = {
          anchorBlockParentRoot,
          anchorBlock: null,
          anchorBlockRoot: anchorCp.root, // this may help
          anchorSlot,
          lastBackSyncedBlock: null,
        };
        // Initialize backfill states to maintain point of reference for future
        await modules.db.backfillRange.put({beginningEpoch: anchorCp.epoch, endingEpoch: anchorCp.epoch});
        await modules.db.backfillState.put(anchorCp.epoch, {hasBlock: true, hasBlobs: true, columnIndices: []});
      }
    } else {
      // Todo: Remove this duplicate code.
      if (isForcedCheckpointSync)
        modules.logger.warn("ForcedCheckpointSync. Initializing backfill states using anchorState(checkpointState).");
      else modules.logger.warn("prevBackfillRange absent in db. Initializing backfill states using anchorState.");
      // use anchor from modules
      const {checkpoint: anchorCp} = computeAnchorCheckpoint(config, anchorState);
      const anchorBlockParentRoot = anchorState.latestBlockHeader.toValue().parentRoot;
      const anchorSlot = anchorState.latestBlockHeader.slot;
      syncAnchor = {
        anchorBlockParentRoot,
        anchorBlock: null,
        anchorBlockRoot: anchorCp.root, // this may help
        anchorSlot,
        lastBackSyncedBlock: null,
      };
      // Initialize backfill states to maintain point of reference for future
      await modules.db.backfillRange.put({beginningEpoch: anchorCp.epoch, endingEpoch: anchorCp.epoch});
      await modules.db.backfillState.put(anchorCp.epoch, {hasBlock: true, hasBlobs: true, columnIndices: []});
    }

    // ***************
    // Already present: anchorState, anchorCp.epoch, anchorCp.root, anchorSlot, wsCheckpoint, anchorBlockHeader
    // Might be present: anchorBlock
    // Must be present: anchorChildBlock

    const backfillStartFromSlot = syncAnchor?.anchorSlot;
    logger.info("Initializing from Checkpoint", {
      root: toRootHex(syncAnchor?.anchorBlockRoot),
      epoch: computeEpochAtSlot(syncAnchor?.anchorSlot),
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

    // there might be multiple ranges but we will store the most recent
    // Todo: Directly use the prev range before resetting in init fn so as to avoid unnecessary call to this fn
    await this.updateNextRangeToSkip();

    this.logger.info("Starting BackfillSync.");
    let iterationCount = 0;

    for await (const _ of this.processor) {
      this.status = BackfillSyncStatus.syncing;
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

      let anchorSlot = this.syncAnchor.anchorSlot ?? this.backfillStartFromSlot;

      if (anchorSlot === GENESIS_SLOT) {
        this.logger.info("Backfill sync success. Reached Genesis slot.");
        this.status = BackfillSyncStatus.completed;
        this.processor.end();
      }

      const head = this.chain.forkChoice.getHead();
      if (computeEpochAtSlot(anchorSlot) < computeEpochAtSlot(head.slot) - this.config.MIN_EPOCHS_FOR_BLOCK_REQUESTS) {
        this.logger.info("Backfill sync success. Reached minimum backfill blocks serving window.");
        this.status = BackfillSyncStatus.completed;
        this.processor.end();
      }

      // handle previously filled ranges
      if (this.nextRangeToSkip?.start === computeEpochAtSlot(anchorSlot - 1)) {
        // Todo: Also handle the case when its in hot db
        const newAnchorSlot = computeStartSlotAtEpoch(this.nextRangeToSkip.end);
        const newAnchorBlock = await this.db.blockArchive.get(newAnchorSlot);
        // ?? await this.db.block.get(newAnchorSlot);
        if (!newAnchorBlock) {
          // invalid range or the block might be in hot db (block repo)
          this.logger.error("Invalid backfill range set. Ignoring the range to be skipped.");
          // Todo: Figure out how exactly to delete this range. Currently simply ignoring it.
          // But how to update nextRangeToSkip?
          // Temporary soln: delete only one (most recent) epoch entry
          this.logger.warn("Deleting epochBackfillState entry for epoch: ", this.nextRangeToSkip.start);
          this.db.backfillState.batchDelete([this.nextRangeToSkip.start]);
        } else {
          anchorSlot = newAnchorSlot;
          const blockRoot = this.config.getForkTypes(anchorSlot).BeaconBlock.hashTreeRoot(newAnchorBlock.message);
          this.syncAnchor = {
            anchorBlockParentRoot: newAnchorBlock?.message.parentRoot,
            anchorBlock: newAnchorBlock,
            anchorBlockRoot: blockRoot, // this may help
            anchorSlot,
            lastBackSyncedBlock: {slot: anchorSlot, root: blockRoot, block: newAnchorBlock},
          };
        }
        this.logger.info("Merging previous filled range with current BackFillRange. Previous Range: ", {
          startEpoch: this.nextRangeToSkip.start,
          endEpoch: this.nextRangeToSkip.end,
        });
        // now we need to update the nextRangeToSkip
        await this.updateNextRangeToSkip();
      }

      // DEBUG_CODE
      this.logger.info("Trying to do backfill sync", {
        iteration: iterationCount,
        totalPeers: this.peers.size,
        peersInMeta: this.peersMeta.size,
        anchorSlot: anchorSlot,
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

      // Flow:
      // get a good peer
      // create beacon_blocks_by_range request
      // send beacon_blocks_by_range request
      // validate blocks
      // store blocks in db blockarchive
      // update lastBackSyncedBlock
      // update BackfillRange and BackfillState
      // update earliestAvailableSlot
      try {
        const {goodPeer, goodPeerMetaData} = this.getGoodSyncPeerWithMeta();

        // Todo: Allow users to configure batchSize
        // default: 32 slots (1 epoch)
        const batchSize = isStartSlotOfEpoch(anchorSlot) ? 32 : anchorSlot % SLOTS_PER_EPOCH;
        const batchStartSlot = Math.max(0, anchorSlot - batchSize);
        // Ex:
        // 0-31, 32-63, 64-95, 96-127, 128-...
        // (epoch 2) 64-32=32 // (epoch 3) 68-(68%32)=68-4=64
        // batchSize: 32      // batchSize: 4
        // batchStartSlot: 32 // batchStartSlot: 64

        const req: phase0.BeaconBlocksByRangeRequest = {
          startSlot: batchStartSlot,
          count: batchSize,
          step: 1,
        };
        const res: WithBytes<SignedBeaconBlock>[] = await this.fetchBlocks(goodPeer, goodPeerMetaData, anchorSlot, req);

        // In the case when first slot is missed, and the request contains only that slot, retry upto 3 times with different peers and then ignore
        if (res.length === 0 && this.currentAttempt < this.MAX_RETRY_ATTEMPTS_FOR_EMPTY_RESPONSE) {
          this.currentAttempt += 1;
          // Todo: Consider using a missedSlot flag for better handling
          continue;
        }

        // Validate, Update State and Persist
        const validationRes = await this.validateBlocks(res);

        if (!validationRes.nextAnchor && res.length === 0) {
          // Missed slot case: we've already updated the backfillDB in prev iteration (ie while filling rest 31 blocks of the epoch).
          // Now, update anchorSlot to proceed further.
          anchorSlot -= 1;
          this.syncAnchor.anchorSlot = anchorSlot;
          // there is no need to update other values inside syncAnchor
          // DEBUG_CODE
          this.logger.info("Updated syncAnchor for missed slot case: ", {
            anchorSlot,
          });
          // DEBUG_CODE
          this.currentAttempt = 1;
          continue;
        }
        if (!validationRes.nextAnchor) {
          throw Error;
        }

        await this.persistBlocks(validationRes.verifiedBlocks);
        await this.updateBackfillRange(validationRes.nextAnchor.slot);
        await this.updateBackfillState(validationRes.nextAnchor.slot);
        await this.updateBackfillStates(validationRes.nextAnchor);

        this.currentAttempt = 1; // won't be hitted

        if (computeEpochAtSlot(anchorSlot) % 5 === 0) await this.checkBackfillStatus();
      } catch (error) {
        this.logger.error("Caught Error: ", {
          error: (error as Error).message,
          errorStack: (error as Error).stack,
        });
        // Todo
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
        // await sleep(5000, this.signal);
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

  private async checkBackfillStatus(): Promise<string[]> {
    let startIndex = 0;
    let endIndex = 0;
    let restarted = false;
    const filledIndices: Map<number, number> = new Map();
    let wasPrevFilled = false;

    const startTime = Date.now();
    for await (const k of this.db.backfillState.keysStream({gte: 0})) {
      let v: EpochBackfillState;
      try {
        v = (await this.db.backfillState.get(k)) as EpochBackfillState;
      } catch (e) {
        // If SSZ decoding fails, treating as a gap
        this.logger.warn("Skipping corrupted backfill state entry", {epoch: k, error: (e as Error).message});
        if (wasPrevFilled) {
          filledIndices.set(startIndex, endIndex);
          wasPrevFilled = false;
        }
        continue;
      }
      // If value is null, treating as a gap
      if (!v) {
        if (wasPrevFilled) {
          filledIndices.set(startIndex, endIndex);
          wasPrevFilled = false;
        }
        continue;
      }
      if (wasPrevFilled && k - endIndex > 1) {
        // gap
        filledIndices.set(startIndex, endIndex);
        restarted = true;
        wasPrevFilled = false; // starting new run
      }
      if (!v.hasBlock) {
        if (wasPrevFilled) {
          filledIndices.set(startIndex, endIndex);
          wasPrevFilled = false;
        }
        continue;
      }
      // now if this block is present
      if (!wasPrevFilled || k === 0 /* Genesis */ || restarted) {
        startIndex = k;
      }
      wasPrevFilled = true;
      endIndex = k;
      restarted = false;
    }
    // loop exited, handle last filled part
    if (wasPrevFilled) filledIndices.set(startIndex, endIndex);
    const endTime = Date.now();

    const filledIndicesArr: string[] = [];
    filledIndices.forEach((v, k) => {
      filledIndicesArr.push(k === v ? `${k}` : `${k}-${v}`);
    });
    this.logger.info("DB BackfillState:", {
      FilledEpochs: filledIndicesArr.join(", "),
      DBFetchTime: endTime - startTime + "ms",
    });
    return filledIndicesArr;
  }

  private getGoodSyncPeerWithMeta(): {
    goodPeer: string;
    goodPeerMetaData: PeerBackfillSyncMeta;
  } {
    // Select best peer
    const goodPeer: PeerIdStr | null = this.getGoodSyncPeer();

    if (!goodPeer) {
      this.logger.info("No eligible peer found for backfill", {
        totalPeers: this.peers.size,
        peersInMeta: this.peersMeta.size,
        anchorSlot: this.syncAnchor.anchorSlot ?? this.backfillStartFromSlot,
      });
      // DEBUG_CODE
      for (const [peerId, meta] of this.peersMeta.entries()) {
        this.logger.debug("Peer status", {
          peer: peerId,
          client: meta?.client,
          connected: this.peers.has(peerId),
          score: meta?.score,
          failedRequests: meta?.failedRequests,
          lastSlotRequested: meta?.lastSlotRequested,
          earliestAvailableSlot: meta?.earliestAvailableSlot,
          avgResTime: meta?.avgResTime.toString() + "ms",
          isConnected: this.peers.has(peerId),
        });
      }
      // DEBUG_CODE
      // continue;
      // throw to continue
      throw Error("Good peer not found. Retry.");
    }

    // Todo: Review null value allowance
    const goodPeerMetaData: PeerBackfillSyncMeta = this.peersMeta.get(goodPeer) || null;
    if (!goodPeerMetaData) {
      this.logger.error("Selected peer has no metadata (should not happen)", {
        peer: goodPeer,
      });
      throw Error("Selected peer has no metadata (should not happen)");
    }
    this.logger.info("Got a good peer to sync", {
      totalPeers: this.peers.size,
      peer: goodPeer,
      client: goodPeerMetaData?.client,
      earliestAvailableSlot: goodPeerMetaData?.earliestAvailableSlot,
      score: goodPeerMetaData?.score,
      lastSlotRequested: goodPeerMetaData?.lastSlotRequested,
      failedRequests: goodPeerMetaData?.failedRequests,
      avgResTime: goodPeerMetaData?.avgResTime.toString() + "ms",
      custodyColumns: prettyPrintIndices(goodPeerMetaData?.custodyColumns),
    });

    return {goodPeer, goodPeerMetaData};
  }

  private async fetchBlocks(
    goodPeer: PeerIdStr,
    goodPeerMetaData: PeerBackfillSyncMeta,
    anchorSlot: number,
    req: phase0.BeaconBlocksByRangeRequest
  ): Promise<WithBytes<SignedBeaconBlock>[]> {
    try {
      // DEBUG_CODE
      this.logger.info("Sending BeaconBlocksByRange request", {
        peer: goodPeer,
        client: goodPeerMetaData?.client,
        startSlot: req.startSlot,
        endSlot: req.startSlot + req.count * req.step - 1,
        count: req.count,
        epoch: computeEpochAtSlot(req.startSlot),
        anchorSlot,
        lastBackSyncedBlockSlot: this.syncAnchor.lastBackSyncedBlock?.slot,
        backfillStartFromSlot: this.backfillStartFromSlot,
      });
      // DEBUG_CODE

      const startTime = Date.now();
      let resTime = 0;
      const res: WithBytes<SignedBeaconBlock>[] = await this.network.sendBeaconBlocksByRange(goodPeer, req);
      resTime = Date.now() - startTime;
      this.logger.info("Got response to beacon_blocks_by_range request. Received blocks: ", {
        // resDetails:
        resTimeMs: resTime.toString() + "ms",
        blocksReceived: res?.length,
        startSlot: res[0]?.data.message.slot,
        // biome-ignore lint/style/useAtIndex: this is correct
        endSlot: res[res?.length - 1]?.data.message.slot,
        epoch: computeEpochAtSlot(res[0]?.data.message.slot),
        // peerDetails:
        peer: goodPeer,
        client: goodPeerMetaData?.client,
        peerScore: goodPeerMetaData?.score,
        peerLastSlotRequested: goodPeerMetaData?.lastSlotRequested,
        peerFailedRequests: goodPeerMetaData?.failedRequests,
        avgResTime: goodPeerMetaData?.avgResTime,
      });

      // Log block details
      if (res.length === 0) {
        this.logger.warn("Empty blocks response", {
          peer: goodPeer,
          ...req,
        });
      } else {
        this.logger.info("Batch block details", {
          slots: res
            .map((elem) => {
              return elem.data.message.slot;
            })
            .toString(),
        });
      }

      // Update metadata
      if (!goodPeerMetaData) {
        throw Error;
      }
      const updatedResTime =
        goodPeerMetaData?.avgResTime === 0 ? resTime : 0.7 * goodPeerMetaData.avgResTime + 0.3 * resTime; // Exponentially Weighted Moving Average. TODO: reconsider fractional params
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
        client: updatedMeta?.client,
        newScore: updatedMeta?.score,
        newLastSlotRequested: updatedMeta?.lastSlotRequested,
        thisResponseTimeMs: resTime.toString() + "ms",
        newAvgResTime: updatedMeta?.avgResTime.toString() + "ms",
      });
      // DEBUG_CODE
      return res;
    } catch (resErr) {
      this.logger.error("Error in beacon_blocks_by_range request. Error msg: ", {
        // iteration: iterationCount,
        peer: goodPeer,
        client: goodPeerMetaData?.client,
        error: (resErr as Error).message,
        stack: (resErr as Error).stack,
        // reqDetails:
        startSlot: req.startSlot,
        count: req.count,
        endSlot: req.startSlot + req.count * req.step - 1,
        epoch: computeEpochAtSlot(req.startSlot),
        lastBackSyncedBlockSlot: this.syncAnchor.lastBackSyncedBlock?.slot,
        backfillStartFromSlot: this.backfillStartFromSlot,
      });
      // Update Metadata
      if (!goodPeerMetaData) throw Error;
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
  }

  private async validateBlocks(res: WithBytes<SignedBeaconBlock>[]): Promise<{
    nextAnchor: BackfillBlock | null;
    verifiedBlocks: WithBytes<SignedBeaconBlock>[];
  }> {
    try {
      // Todo: Remove these:
      // Todo: handle this in some way. Do we really need to discard the incomplete res?
      // missing last slots and missing intermediate slots in response will throw `BackfillSyncErrorCode.NOT_ANCHORED`
      // and `BackfillSyncErrorCode.NOT_LINEAR` errors respectively, except when there is an actual missed slot
      // we need to check only if first slot is present to ensure the whole sequence is present.
      // but first slot can also be empty, so need to figure out some workaround.
      // if (res?.length !== req.count) throw Error("Didn't recieve full sequence, Retry!");

      const anchorParentRoot = this.syncAnchor.anchorBlockParentRoot;
      // nextAnchor is present in the sequence
      const {nextAnchor, verifiedBlocks /* , error */} = verifyBlockSequence(this.config, res, anchorParentRoot);
      // Note that blocks in both res and verifiedBlocks are in reverse order now, because the
      // blocks.reverse() inside verifyBlockSequence() mutates the original data.

      // Skip validation for len=0 as this is surely empty slot
      if (!nextAnchor && verifiedBlocks?.length === 0) {
        this.logger.warn("Ignoring missed slot");
        return {verifiedBlocks, nextAnchor};
      }
      // this should not happen
      if (!nextAnchor && verifiedBlocks?.length > 0) throw Error("Didn't receive nextAnchor. Retry!");

      this.logger.info("Verified Block Sequence", {
        nextAnchor: nextAnchor?.slot,
        verifiedBlocks: verifiedBlocks?.length,
        firstBlockSlot: res[0].data.message.slot,
        // biome-ignore lint/style/useAtIndex: this is correct
        lastBlockSlot: res[res?.length - 1].data.message.slot,
        verifiedBlocksStart: verifiedBlocks[0].data.message.slot,
        // biome-ignore lint/style/useAtIndex: this is correct
        verifiedBlocksEnd: verifiedBlocks[verifiedBlocks.length - 1].data.message.slot,
        epoch: computeEpochAtSlot(verifiedBlocks[0].data.message.slot),
      });

      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), verifiedBlocks);
      this.logger.info("Verified Block Proposer Signatures.");

      return {verifiedBlocks, nextAnchor};
    } catch (validErr) {
      this.logger.error("Block Sequence validation failed", {
        anchorBlockSlot: this.syncAnchor.anchorSlot,
        anchorParentRoot: this.syncAnchor.anchorBlockParentRoot.toString(),
        firstBlockSlot: res[0]?.data.message.slot,
        // biome-ignore lint/style/useAtIndex: this is correct
        lastBlockSlot: res[res?.length - 1]?.data.message.slot,
        blockSequenceLength: res?.length,
        error: (validErr as Error).message,
        stack: (validErr as Error).stack,
      });
      throw Error("Validation Error");
    }
  }

  private async persistBlocks(verifiedBlocks: WithBytes<SignedBeaconBlock>[]) {
    // Store in db: blockarchive in the format: KeyValue<Slot, SignedBeaconBlock>[]
    try {
      await this.db.blockArchive.batchPutBinary(
        verifiedBlocks.map((block) => ({
          key: block.data.message.slot,
          value: block.bytes,
          slot: block.data.message.slot,
          blockRoot: this.config.getForkTypes(block.data.message.slot).BeaconBlock.hashTreeRoot(block.data.message),
          parentRoot: block.data.message.parentRoot,
        }))
      );
    } catch (error) {
      this.logger.error("Error storing backfill batch to db.", {
        firstBlockSlot: verifiedBlocks[0].data.message.slot,
        // biome-ignore lint/style/useAtIndex: this is correct
        lastBlockSlot: verifiedBlocks[verifiedBlocks?.length - 1].data.message.slot,
        epoch: computeEpochAtSlot(verifiedBlocks[0].data.message.slot),
      });
      throw error as Error;
    }
  }

  private async updateBackfillRange(nextAnchorSlot: Slot) {
    // Update BackfillRange
    const t1 = Date.now();
    const prevBackfillRange = await this.db.backfillRange.get();
    if (!prevBackfillRange) {
      // this shouldn't happen as we are initializing in init fn
      this.db.backfillRange.put({
        beginningEpoch: computeEpochAtSlot(this.syncAnchor?.anchorSlot!),
        endingEpoch: computeEpochAtSlot(nextAnchorSlot),
      });
      // DEBUG_CODE
      this.logger.warn("This shouldn't happen here. Initialized backfillRange: ", {
        beginningEpoch: computeEpochAtSlot(this.syncAnchor?.anchorSlot!),
        endingEpoch: computeEpochAtSlot(nextAnchorSlot),
      });
      // DEBUG_CODE
    } else {
      this.db.backfillRange.put({
        beginningEpoch: prevBackfillRange.beginningEpoch,
        endingEpoch: computeEpochAtSlot(nextAnchorSlot),
      });

      // DEBUG_CODE
      this.logger.info("Updated backfillRange: ", {
        beginningEpoch: prevBackfillRange.beginningEpoch,
        endingEpoch: computeEpochAtSlot(nextAnchorSlot),
      });
      // DEBUG_CODE
    }
    const t2 = Date.now();
    this.logger.info("Update backfill range: ", {updateTime: (t2 - t1).toString() + "ms"});
  }

  private async updateBackfillState(nextAnchorSlot: Slot) {
    // Update BackfillState
    const t3 = Date.now();
    const prevBackfillStateData = await this.db.backfillState.get(computeEpochAtSlot(nextAnchorSlot));
    if (!prevBackfillStateData) {
      const backfillStateData = {
        hasBlock: true,
        hasBlobs: false,
        columnIndices: [],
      };
      await this.db.backfillState.put(computeEpochAtSlot(nextAnchorSlot), backfillStateData);
      this.logger.info("Updated backfillState:", {
        epoch: computeEpochAtSlot(nextAnchorSlot),
        hasBlock: backfillStateData.hasBlock,
        hasBlobs: backfillStateData.hasBlobs,
        columns: prettyPrintIndices(backfillStateData.columnIndices),
      });
    } else {
      const updatedStateData = {
        ...prevBackfillStateData,
        hasBlock: true,
      };
      await this.db.backfillState.put(computeEpochAtSlot(nextAnchorSlot), updatedStateData);
      this.logger.info("Updated backfillState:", {
        epoch: computeEpochAtSlot(nextAnchorSlot),
        hasBlock: updatedStateData.hasBlock,
        hasBlobs: updatedStateData.hasBlobs,
        columns: prettyPrintIndices(updatedStateData.columnIndices || []),
        // prevBackfillStateData:
        prevhasBlock: prevBackfillStateData.hasBlock,
        prevhasBlobs: prevBackfillStateData.hasBlobs,
        prevcolumns: prettyPrintIndices(prevBackfillStateData.columnIndices || []),
      });
    }
    const t4 = Date.now();
    this.logger.info("Update backfill state: ", {updateTime: (t4 - t3).toString() + "ms"});
    // DEBUG_CODE
  }

  private async updateBackfillStates(nextAnchor: BackfillBlock | null) {
    if (!nextAnchor) {
      throw Error;
    }
    // Update lastBackSyncedBlock
    this.syncAnchor = {
      lastBackSyncedBlock: nextAnchor,
      anchorBlock: nextAnchor?.block,
      anchorBlockParentRoot: nextAnchor?.block.message.parentRoot,
      anchorBlockRoot: nextAnchor?.root,
      anchorSlot: nextAnchor?.slot,
    };

    // DEBUG_CODE
    this.logger.info("Updated syncAnchor: ", {
      lastBackSyncedBlockSlot: nextAnchor?.slot,
      anchorBlockSlot: nextAnchor?.block.message.slot,
      anchorBlockParentRoot: toHex(nextAnchor?.block.message.parentRoot),
      anchorBlockRoot: toHex(nextAnchor?.root),
      anchorSlot: nextAnchor?.slot,
    });
    // DEBUG_CODE
    // Todo: update earliestAvailableSlot
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  private addPeer = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    // TODO: use db singleton object: BackfillRange to get anchorSlot
    const anchorSlot = this.syncAnchor.anchorSlot ?? this.backfillStartFromSlot;

    // DEBUG_CODE
    // this.logger.info("Add peer bf:", {ourpeerhead: data.status.headSlot, anchorSlot});
    // DEBUG_CODE

    const peerMetaData = this.network.getConnectedPeerSyncMeta(data.peer);
    const earliestAvailableSlot = (data.status as fulu.Status).earliestAvailableSlot;

    // Reconsider logic for earliestAvailableSlot value, a peer irrelevant now can be relevant in later stage of backfill.
    // Assuming short lived connections for now, and hence ignoring above comment.
    if (data.status.headSlot < anchorSlot) {
      // DEBUG_CODE
      this.logger.warn("Peer head too far behind", {
        // we cant trust this peer
        peer: data.peer,
        peerHead: data.status.headSlot,
        anchorSlot,
      });
      // DEBUG_CODE
      return;
    }
    // ignore irrelevant peers
    if (peerMetaData.earliestAvailableSlot !== undefined && peerMetaData.earliestAvailableSlot > anchorSlot) {
      // DEBUG_CODE
      this.logger.warn("Peer might not have required historical data", {
        peer: data.peer,
        earliestAvailableSlot,
        anchorSlot,
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
  private getGoodSyncPeer = (): PeerIdStr | null => {
    const eligiblePeers: PeerIdStr[] = [];
    // TODO: use db singleton object: BackfillRange to get requiredSlot
    const anchorSlot = this.syncAnchor.anchorSlot ?? this.backfillStartFromSlot;

    // DEBUG_CODE
    // this.logger.info("Selecting peer for backfill", {
    //   anchorSlot,
    //   totalPeersConnected: this.peers.size,
    //   totalPeersInMeta: this.peersMeta.size,
    // });
    // DEBUG_CODE

    for (const [peerId, meta] of this.peersMeta.entries()) {
      // if metadata present but currently not connected
      if (!this.peers.has(peerId)) {
        continue;
      }
      if (meta?.failedRequests && meta.failedRequests >= 3) {
        // DEBUG_CODE
        // this.logger.warn("Skipping peer with too many failures", {
        //   peerId,
        //   client: meta.client,
        //   failedRequests: meta.failedRequests,
        // });
        // DEBUG_CODE
        continue;
      }
      if (meta?.earliestAvailableSlot !== undefined && meta.earliestAvailableSlot > anchorSlot) {
        // DEBUG_CODE
        // this.logger.warn("Skipping peer without reqd data", {
        //   peerId,
        //   earliestAvailableSlot: meta.earliestAvailableSlot,
        //   anchorSlot,
        // });
        // DEBUG_CODE
        continue;
      }
      // if lastSlotRequest is very recent
      if (
        meta?.lastSlotRequested &&
        meta.lastSlotRequested !== 0 &&
        Math.abs(meta.lastSlotRequested - anchorSlot) < 2 * 32 // this.opts.backfillBatchSize
      ) {
        // DEBUG_CODE
        // this.logger.info("Skipping recently used peer", {
        //   peerId,
        //   lastSlotRequested: meta.lastSlotRequested,
        //   anchorSlot,
        // });
        // DEBUG_CODE
        continue;
      }
      eligiblePeers.push(peerId);
    }

    if (eligiblePeers.length === 0) {
      this.logger.warn("No eligible peers for backfill", {
        totalPeers: this.peers.size,
        anchorSlot,
      });
      // throw to catch in sync loop
      // throw Error("No eligible peers for backfill");
      return null;
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

  private async updateNextRangeToSkip() {
    const backfillRanges: string[] = await this.checkBackfillStatus();
    if (backfillRanges.length > 1) {
      const currentFilledRange: string[] = backfillRanges.at(-1)?.split("-")!;
      const prevFilledRange: string[] = backfillRanges.at(-2)?.split("-")!;
      // in reverse order
      this.nextRangeToSkip = {
        start: Number(prevFilledRange.at(-1)),
        end: Number(prevFilledRange[0]),
      };
      // ideally no need to update as it will be automatically updated as we will update anchorBlock anyways
      const updatedBackfillRange = {
        beginningEpoch: Number(currentFilledRange.at(-1)),
        endingEpoch: Number(currentFilledRange[0]),
      };
      if (updatedBackfillRange.beginningEpoch === updatedBackfillRange.endingEpoch) {
        this.logger.info("Node startup case. BackfillRange must have been initialized already.");
      } else {
        this.db.backfillRange.put(updatedBackfillRange);
        this.logger.info(
          "Updated backfillRange while merging backfill ranges and updating nextRangeToSkip: ",
          updatedBackfillRange
        );
      }
    }
    // if restarting with forced checkpoint within same epoch update backfillRange
    else if (backfillRanges.length === 1) {
      const currentFilledRange: string[] = backfillRanges[0]?.split("-");
      this.nextRangeToSkip = null;
      const updatedBackfillRange = {
        beginningEpoch: Number(currentFilledRange.at(-1)),
        endingEpoch: Number(currentFilledRange[0]),
      };
      if (updatedBackfillRange.beginningEpoch === updatedBackfillRange.endingEpoch) {
        this.logger.info("Node startup case. BackfillRange must have been initialized already.");
      } else {
        this.db.backfillRange.put(updatedBackfillRange);
        this.logger.info(
          "Updated backfillRange while merging backfill ranges and updating nextRangeToSkip: ",
          updatedBackfillRange
        );
      }
    } else {
      this.nextRangeToSkip = null;
    }
    this.logger.info("Updated nextRangeToSkip: ", this.nextRangeToSkip);
  }
}
