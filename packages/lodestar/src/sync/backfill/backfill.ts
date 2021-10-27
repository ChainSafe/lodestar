import {IMetrics} from "../../metrics/metrics";
import {EventEmitter} from "events";
import PeerId from "peer-id";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, Root, Slot, allForks, ssz} from "@chainsafe/lodestar-types";
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

/** Default batch size. Same as range sync (2 epochs) */
const BATCH_SIZE = 64;

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: IBeaconConfig;
  logger: ILogger;
  metrics: IMetrics | null;
};

export type BackfillSyncOpts = {
  batchSize: number;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
}

/** Map a SyncState to an integer for rendering in Grafana */
const syncStatus: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.pending]: 0,
  [BackfillSyncStatus.syncing]: 1,
  [BackfillSyncStatus.completed]: 2,
};

type BackfillSyncEvents = {
  // slot param is oldest slot synced
  [BackfillSyncEvent.completed]: (oldestSlotSynced: Slot) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetrics | null;
  private opts: BackfillSyncOpts;

  // At any given point, we should have either the anchorBlock, or anchorBlockRoot, the reversed head of the backfill sync, from where we need to backfill
  private anchorBlock: allForks.SignedBeaconBlock | null = null;
  private anchorBlockRoot?: Root | null = null;

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
    this.opts = opts ?? {batchSize: BATCH_SIZE};
    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);

    this.sync()
      .then((oldestSlotSynced) => {
        this.emit(BackfillSyncEvent.completed, oldestSlotSynced);
        this.logger.info("BackfillSync completed", {oldestSlotSynced});
        this.status = BackfillSyncStatus.completed;
        // Sync completed, unsubscribe listeners and don't run the processor again
        // Backfill is never necessary again until the node shuts down
        this.close();
      })
      .catch((e) => {
        if (e instanceof ErrorAborted) {
          return; // Ignore
        }
        this.logger.error("BackfillSync processor error", e);
        this.status = BackfillSyncStatus.completed;
        this.close();
      });
    if (this.metrics) {
      this.metrics.backfillSync.status.addCollect(() => this.metrics?.backfillSync.status.set(syncStatus[this.status]));
    }
  }

  /** Throw / return all AsyncGenerators */
  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  /** Returns oldestSlotSynced */
  private async sync(): Promise<Slot> {
    //Initial check, could be issue if somebody stops and starts node later from WSS
    // as it will already contain genesis block but not blkocks in between

    const {root, epoch} = this.chain.forkChoice.getFinalizedCheckpoint();
    const oldestBlock = await this.db.blockArchive.firstValue();

    if (epoch <= 0 || oldestBlock?.message.slot === GENESIS_SLOT) {
      this.logger.info("BackfillSync - already backfilled to genesis, exiting");
      return GENESIS_SLOT;
    }
    this.logger.info("BackfillSync initializing from cp", {epoch, root: toHexString(root)});

    this.anchorBlock = oldestBlock ?? null;
    if (!this.anchorBlock) {
      // Attempt to find the anchor block in the DB
      try {
        this.anchorBlock = await this.db.blockArchive.getByRoot(root);
      } catch (e) {
        this.logger.error("Error fetching blockArchive", {root: toHexString(root)}, e as Error);
      }
    }

    // Start processor loop
    this.processor.trigger();

    for await (const _ of this.processor) {
      const peer = shuffleOne(this.peers.values());
      if (!peer) {
        this.logger.info("BackfillSync no peers yet");
        continue;
      }

      try {
        if (!this.anchorBlock) {
          // In case of irrecoverable error, both anchorBlock and anchorBlockRoot could be nullified in order to start Backfill sync afresh!
          if (!this.anchorBlockRoot) {
            const anchorCp = this.chain.forkChoice.getFinalizedCheckpoint();
            this.anchorBlockRoot = anchorCp.root;
            this.logger.warn("BackfillSync - No anchor root, BackfillSync reset from chain's finalized checkpoint", {
              root: toHexString(anchorCp.root),
              epoch: anchorCp.epoch,
            });
          }

          this.anchorBlock = await this.syncBlockByRoot(peer, this.anchorBlockRoot);
          if (!this.anchorBlock) continue; // Try from another peer
          this.logger.info("BackfillSync - fetched new anchorBlock", {
            root: toHexString(this.anchorBlockRoot),
            slot: this.anchorBlock.message.slot,
          });
        }

        //synced to genesis
        if (this.anchorBlock.message.slot === GENESIS_SLOT) {
          this.logger.info("BackfillSync - successfully synced to genesis, exiting");
          return GENESIS_SLOT;
        }

        const toSlot = this.anchorBlock.message.slot;
        const fromSlot = Math.max(toSlot - this.opts.batchSize, GENESIS_SLOT);
        this.logger.warn("BackfillSync syncing", {fromSlot, toSlot});
        await this.syncRange(peer, fromSlot, toSlot, this.anchorBlock.message.parentRoot);
      } catch (e) {
        this.metrics?.backfillSync.errors.inc();
        this.logger.error("BackfillSync sync error", {}, e as Error);

        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.NOT_ANCHORED:
              // Lets try to just get the parent of this anchorBlock as it might be couple of skipped steps behind
              this.anchorBlockRoot = this.anchorBlock?.message.parentRoot;
              this.anchorBlock = null;
            /* falls through */
            case BackfillSyncErrorCode.INVALID_SIGNATURE:
            case BackfillSyncErrorCode.NOT_LINEAR:
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
    this.logger.info("BackfillSync add peer", {peerhead: peerStatus.headSlot, requiredSlot});
    if (peerStatus.headSlot >= requiredSlot) {
      this.peers.add(peerId);
      this.processor.trigger();
    }
  };

  private removePeer = (peerId: PeerId): void => {
    this.peers.delete(peerId);
  };

  private async syncBlockByRoot(peer: PeerId, root: Root): Promise<allForks.SignedBeaconBlock | null> {
    const [block] = await this.network.reqResp.beaconBlocksByRoot(peer, [root] as List<Root>);
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (block) {
      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), [block]);
      await this.db.blockArchive.put(block.message.slot, block);
      this.metrics?.backfillSync.totalBlocks.inc();
    }
    return block;
  }

  private async syncRange(peer: PeerId, from: Slot, to: Slot, anchorRoot: Root): Promise<void> {
    const blocks = await this.network.reqResp.beaconBlocksByRange(peer, {startSlot: from, count: to - from, step: 1});
    if (blocks.length === 0) {
      return;
      verifyBlockSequence;
    }

    const {nextAnchor, verifiedBlocks, error} = verifyBlockSequence(this.config, blocks, anchorRoot);
    console.log("nextAnchor ", ssz.Root.toJson(nextAnchor), "error", error);
    this.logger.warn(`BackfillSync - original length: ${blocks.length}  verified block seq ${verifiedBlocks.length}`);

    // If any of the block's proposer signature fail, we can't trust this peer at all
    if (verifiedBlocks.length > 0)
      await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), verifiedBlocks);

    await this.db.blockArchive.batchAdd(verifiedBlocks);
    this.metrics?.backfillSync.totalBlocks.inc(verifiedBlocks.length);
    // If no error, everything went good, linear chain, first block is oldest
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (error === undefined && blocks[0]) {
      this.anchorBlock = blocks[0];
      this.anchorBlockRoot = null;
    } else {
      // The next previous block be many skipped steps behind so lets set the anchorBlockRoot for main process for it to fetch it singleton
      this.anchorBlock = null;
      this.anchorBlockRoot = nextAnchor;
    }
    if (error) throw new BackfillSyncError({code: error});
  }
}
