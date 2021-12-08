import {IMetrics} from "../../metrics/metrics";
import {EventEmitter} from "events";
import PeerId from "peer-id";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, Root, Slot, allForks} from "@chainsafe/lodestar-types";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {List, toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../chain";
import {GENESIS_SLOT} from "../../constants";
import {IBeaconDb} from "../../db";
import {INetwork, NetworkEvent, PeerAction} from "../../network";
import {ItTrigger} from "../../util/itTrigger";
import {PeerSet} from "../../util/peerMap";
import {shuffleOne} from "../../util/shuffle";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors";
import {verifyBlockProposerSignature, verifyBlockSequence} from "./verify";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

/** Default batch size. Same as range sync (2 epochs) */
const BATCH_SIZE = 64;

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: IBeaconConfig;
  logger: ILogger;
  metrics: IMetrics | null;
  wsCheckpoint?: phase0.Checkpoint;
};

export type BackfillSyncOpts = {
  batchSize: number;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncMethod {
  database = "database",
  backfilled_ranges = "backfilled_ranges",
  rangesync = "rangesync",
  blockbyroot = "blockbyroot",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
  aborted = "aborted",
}

/** Map a SyncState to an integer for rendering in Grafana */
const syncStatus: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.aborted]: 0,
  [BackfillSyncStatus.pending]: 1,
  [BackfillSyncStatus.syncing]: 2,
  [BackfillSyncStatus.completed]: 3,
};

type BackfillSyncEvents = {
  [BackfillSyncEvent.completed]: (
    /** Oldest slot synced */
    oldestSlotSynced: Slot
  ) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  lastBackSyncedSlot: Slot | null = null;

  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetrics | null;
  private wsCheckpoint: phase0.Checkpoint | null;
  private checkpointSlot: Slot;
  private opts: BackfillSyncOpts;

  /**
   * At any given point, we should have either the anchorBlock or anchorBlockRoot,
   * the reversed head of the backfill sync, from where we need to backfill
   */
  private anchorBlock: allForks.SignedBeaconBlock | null = null;
  private anchorBlockRoot: Root | null = null;
  private backfillStartFromSlot: Slot | null = null;

  private processor = new ItTrigger();
  private peers = new PeerSet();
  private status: BackfillSyncStatus = BackfillSyncStatus.pending;

  constructor(modules: BackfillSyncModules, opts?: BackfillSyncOpts) {
    super();
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.wsCheckpoint = modules.wsCheckpoint ?? null;
    this.checkpointSlot = (this.wsCheckpoint?.epoch ?? 0) * SLOTS_PER_EPOCH;
    this.opts = opts ?? {batchSize: BATCH_SIZE};
    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);

    this.sync()
      .then((oldestSlotSynced) => {
        this.emit(BackfillSyncEvent.completed, oldestSlotSynced);
        this.logger.info("BackfillSync completed", {oldestSlotSynced});
        this.status = BackfillSyncStatus.completed;
        // Sync completed, unsubscribe listeners and don't run the processor again.
        // Backfill is never necessary again until the node shuts down
        this.close();
      })
      .catch((e) => {
        this.logger.error("BackfillSync processor error", e);
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });

    const metrics = this.metrics;
    if (metrics) {
      metrics.backfillSync.status.addCollect(() => metrics.backfillSync.status.set(syncStatus[this.status]));
      metrics.backfillSync.backfilledTillSlot.addCollect(
        () => this.lastBackSyncedSlot != null && metrics.backfillSync.backfilledTillSlot.set(this.lastBackSyncedSlot)
      );
    }
  }

  /** Throw / return all AsyncGenerators */
  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  /**
   * @returns Returns oldestSlotSynced
   */
  private async sync(): Promise<Slot> {
    // Start processor loop
    this.processor.trigger();
    await this.initializeSync();

    for await (const _ of this.processor) {
      this.status = BackfillSyncStatus.syncing;

      // 1. We should always have either anchorBlock or anchorBlockRoot, they are the
      //    anchor points for this round of the sync
      // 2. Check if we can jump back from available backfill sequence
      // 3. Validate checkpoint once if synced
      // 4. Exit the sync if backfilled till genesis
      // 5. Check and read batchSize from DB, if found yield and recontinue from top
      // 6. If not in DB, and if peer available, read batchSize from network recontinue
      if (!this.anchorBlock && !this.anchorBlockRoot) {
        this.logger.error("BackfillSync - irrevocable error, no valid anchorBlock or anchorBlockRoot");
        /** Break sync loop and throw error */
        break;
      }

      await this.checkUpdateFromBackfillSequences();
      await this.checkIfCheckpointSyncedAndValidate();
      if (this.anchorBlock?.message.slot === GENESIS_SLOT) {
        this.logger.verbose("BackfillSync - successfully synced to genesis, exiting");
        return GENESIS_SLOT;
      }

      // Inspect in DB for batchSize blocks, post which yield control back to the loop
      const inspectDbRoot = this.anchorBlock?.message.parentRoot || this.anchorBlockRoot;
      if (!inspectDbRoot) throw new Error("BackfillSyncInternalError");
      const dbBackBlock = await this.fastBackfillDb(inspectDbRoot);
      if (dbBackBlock) {
        this.anchorBlock = dbBackBlock;
        this.lastBackSyncedSlot = dbBackBlock.message.slot;
        this.anchorBlockRoot = null;
        this.processor.trigger();
        continue;
      }

      // Try the network if nothing found in DB
      const peer = shuffleOne(this.peers.values());
      if (!peer) {
        this.status = BackfillSyncStatus.pending;
        this.logger.debug("BackfillSync no peers yet");
        continue;
      }

      try {
        if (!this.anchorBlock && this.anchorBlockRoot) {
          this.anchorBlock = await this.syncBlockByRoot(peer, this.anchorBlockRoot);
          if (!this.anchorBlock) throw new Error("InvalidBlockSyncedFromPeer");
          this.logger.verbose("BackfillSync - fetched new anchorBlock", {
            root: toHexString(this.anchorBlockRoot),
            backfilledSlot: this.anchorBlock.message.slot,
          });
          this.lastBackSyncedSlot = this.anchorBlock.message.slot;

          // Go back to start, do checks
          this.processor.trigger();
          continue;
        }

        if (!this.anchorBlock) continue;
        const toSlot = this.anchorBlock.message.slot;
        const fromSlot = Math.max(toSlot - this.opts.batchSize, GENESIS_SLOT);
        await this.syncRange(peer, fromSlot, toSlot, this.anchorBlock.message.parentRoot);
      } catch (e) {
        this.metrics?.backfillSync.errors.inc();
        this.logger.error("BackfillSync sync error", {}, e as Error);

        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.NOT_ANCHORED:
            case BackfillSyncErrorCode.NOT_LINEAR:
              // Lets try to jump directly to the parent of this anchorBlock as previous
              // (segment) of blocks could be orphaned
              this.anchorBlockRoot = this.anchorBlock ? this.anchorBlock.message.parentRoot : null;
              this.anchorBlock = null;
            // falls through
            case BackfillSyncErrorCode.INVALID_SIGNATURE:
              this.network.reportPeer(peer, PeerAction.LowToleranceError, "BadSyncBlocks");
          }
        }
      } finally {
        this.processor.trigger();
      }
    }

    throw new ErrorAborted("BackfillSync");
  }

  private addPeer = (peerId: PeerId, peerStatus: phase0.Status): void => {
    const requiredSlot =
      this.anchorBlock?.message.slot ?? computeStartSlotAtEpoch(this.chain.forkChoice.getFinalizedCheckpoint().epoch);
    this.logger.debug("BackfillSync add peer", {peerhead: peerStatus.headSlot, requiredSlot});
    if (peerStatus.headSlot >= requiredSlot) {
      this.peers.add(peerId);
      this.processor.trigger();
    }
  };

  private removePeer = (peerId: PeerId): void => {
    this.peers.delete(peerId);
  };

  private async initializeSync(): Promise<void> {
    const anchorCp = this.chain.forkChoice.getFinalizedCheckpoint();
    // Look in db, as finalized root might not have moved at all on a quick restart
    this.anchorBlock = await this.db.blockArchive.getByRoot(anchorCp.root);
    if (this.anchorBlock) {
      this.lastBackSyncedSlot = this.anchorBlock.message.slot;
    } else {
      this.anchorBlockRoot = anchorCp.root;
      this.lastBackSyncedSlot = null;
    }

    this.backfillStartFromSlot = anchorCp.epoch * SLOTS_PER_EPOCH;
    this.logger.info("BackfillSync - initializing from Checkpoint", {
      root: toHexString(anchorCp.root),
      epoch: anchorCp.epoch,
    });
  }

  private async checkIfCheckpointSyncedAndValidate(): Promise<void> {
    if (
      this.wsCheckpoint !== null &&
      this.lastBackSyncedSlot !== null &&
      this.checkpointSlot >= this.lastBackSyncedSlot
    ) {
      // Checkpoint root should be in db now!
      const wsDbCheckpointBlock = await this.db.blockArchive.getByRoot(this.wsCheckpoint.root);
      if (!wsDbCheckpointBlock || wsDbCheckpointBlock.message.slot !== this.checkpointSlot)
        // TODO: explode and stop the entire node
        throw new Error(
          `InvalidWsCheckpoint checkpointSlot: ${this.checkpointSlot}, ${
            wsDbCheckpointBlock ? "found at: " + wsDbCheckpointBlock?.message.slot : "not found"
          }`
        );
      this.logger.info("BackfillSync - wsCheckpoint validated!", {
        root: toHexString(this.wsCheckpoint.root),
        slot: wsDbCheckpointBlock.message.slot,
      });
      // no need to check again
      this.wsCheckpoint = null;
    }
  }

  private async checkUpdateFromBackfillSequences(): Promise<void> {
    if (this.lastBackSyncedSlot !== null && this.backfillStartFromSlot !== null) {
      const filteredSeqs = await this.db.backfilledRanges.entries({
        gte: this.lastBackSyncedSlot,
        lte: this.backfillStartFromSlot,
      });
      const jumpBackTo = filteredSeqs.reduce((acc, entry) => {
        if (entry.value < acc) acc = entry.value;
        return acc;
      }, this.lastBackSyncedSlot);
      if (jumpBackTo < this.lastBackSyncedSlot) {
        this.anchorBlock = await this.db.blockArchive.get(jumpBackTo);
        this.anchorBlockRoot = null;
        this.metrics?.backfillSync.totalBlocks.inc(
          {method: BackfillSyncMethod.backfilled_ranges},
          this.lastBackSyncedSlot - jumpBackTo
        );
        this.lastBackSyncedSlot = jumpBackTo;
        this.logger.verbose("backfillSync - found previous backfilled sequence in db, jumping back to", {
          slot: jumpBackTo,
        });
      }
      await this.db.backfilledRanges.put(this.backfillStartFromSlot, this.lastBackSyncedSlot);
      await this.db.backfilledRanges.batchDelete(
        filteredSeqs.filter((entry) => entry.key !== this.backfillStartFromSlot).map((entry) => entry.key)
      );
    }
  }

  private async fastBackfillDb(root: Root): Promise<allForks.SignedBeaconBlock | null> {
    let anchorBlock = await this.db.blockArchive.getByRoot(root);
    if (!anchorBlock) {
      return null;
    }
    let parentBlock,
      backCount = 0;
    while ((parentBlock = await this.db.blockArchive.getByRoot(anchorBlock.message.parentRoot))) {
      anchorBlock = parentBlock;
      backCount++;
      if (backCount % this.opts.batchSize === 0) {
        break;
      }
    }
    this.lastBackSyncedSlot = anchorBlock.message.slot;
    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.database}, backCount);
    this.logger.verbose(`BackfillSync - read ${backCount} blocks from DB till `, {slot: anchorBlock.message.slot});
    return anchorBlock;
  }

  private async syncBlockByRoot(peer: PeerId, root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const [block] = await this.network.reqResp.beaconBlocksByRoot(peer, [root] as List<Root>);
    if (block !== undefined) {
      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), [block]);
      await this.db.blockArchive.put(block.message.slot, block);
      this.lastBackSyncedSlot = block.message.slot;
      this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.blockbyroot});
    }
    return block;
  }

  private async syncRange(peer: PeerId, from: Slot, to: Slot, anchorRoot: Root): Promise<void> {
    const blocks = await this.network.reqResp.beaconBlocksByRange(peer, {startSlot: from, count: to - from, step: 1});
    if (blocks.length === 0) {
      return;
    }

    const {nextAnchor, verifiedBlocks, error} = verifyBlockSequence(this.config, blocks, anchorRoot);
    this.logger.debug("BackfillSync - syncRange: ", {
      from,
      to,
      discovered: blocks.length,
      verified: verifiedBlocks.length,
    });

    // If any of the block's proposer signature fail, we can't trust this peer at all
    if (verifiedBlocks.length > 0)
      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), verifiedBlocks);

    await this.db.blockArchive.batchAdd(verifiedBlocks);
    this.metrics?.backfillSync.totalBlocks.inc({method: BackfillSyncMethod.rangesync}, verifiedBlocks.length);

    // If nextAnchor provided, found some linear anchored blocks
    if (nextAnchor !== null) {
      this.anchorBlock = nextAnchor;
      this.lastBackSyncedSlot = nextAnchor.message.slot;
      this.anchorBlockRoot = null;
      this.logger.verbose(`BackfillSync - syncRange discovered ${verifiedBlocks.length} valid blocks`, {
        backfilledSlot: this.lastBackSyncedSlot,
      });
    }
    if (error) throw new BackfillSyncError({code: error});
  }
}
