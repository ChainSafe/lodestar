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
  /** last trusted block */
  private anchorBlock: allForks.SignedBeaconBlock | null = null;
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
    const {root, epoch} = this.chain.forkChoice.getFinalizedCheckpoint();
    if (epoch <= 0) {
      this.logger.debug("BackfillSync no necessary on genesis");
      return 0;
    }

    this.logger.debug("BackfillSync initializing from cp", {epoch, root: toHexString(root)});

    //Initial check, could be issue if somebody stops and starts node later from WSS
    // as it will already contain genesis block but not blkocks in between
    const oldestBlock = await this.db.blockArchive.firstValue();
    if (oldestBlock?.message.slot === GENESIS_SLOT) {
      this.logger.debug("BackfillSync already synced to genesis block");
      return GENESIS_SLOT;
    }

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
        this.logger.debug("BackfillSync no peers yet");
        continue;
      }

      try {
        // First get anchor block
        if (!this.anchorBlock) {
          const anchorBlockRoot = this.chain.forkChoice.getFinalizedCheckpoint().root;
          this.anchorBlock = await this.syncBlockByRoot(peer, anchorBlockRoot);
          if (this.anchorBlock) {
            this.logger.debug("BackfillSync fetched anchorBlock", {root: toHexString(anchorBlockRoot)});
          } else {
            // If syncBlockByRoot could not find anchorBlock, loop and try again with another peer
            continue;
          }
        }

        //synced to genesis
        if (this.anchorBlock.message.slot === GENESIS_SLOT) {
          return GENESIS_SLOT;
        }

        const toSlot = this.anchorBlock.message.slot;
        const fromSlot = Math.max(toSlot - this.opts.batchSize, GENESIS_SLOT);
        this.logger.debug("BackfillSync syncing range", {fromSlot, toSlot});
        await this.syncRange(peer, fromSlot, toSlot, this.anchorBlock.message.parentRoot);
      } catch (e) {
        this.metrics?.backfillSync.errors.inc();
        this.logger.error("BackfillSync sync error", {}, e as Error);

        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.INVALID_SIGNATURE:
            case BackfillSyncErrorCode.NOT_LINEAR:
            case BackfillSyncErrorCode.NOT_ANCHORED:
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

  private removePeer(peerId: PeerId): void {
    this.peers.delete(peerId);
  }

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

    verifyBlockSequence(this.config, blocks, anchorRoot);
    await verifyBlockProposerSignature(this.chain.bls, this.chain.getHeadState(), blocks);

    await this.db.blockArchive.batchAdd(blocks);
    this.metrics?.backfillSync.totalBlocks.inc(blocks.length);
    // first block is oldest
    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (blocks[0]) {
      this.anchorBlock = blocks[0];
    }
  }
}
