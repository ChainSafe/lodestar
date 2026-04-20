import {EventEmitter} from "node:events";
import {PeerId} from "@libp2p/interface";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {IBeaconStateView, computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, Root, SignedBeaconBlock, Slot, ssz} from "@lodestar/types";
import {ErrorAborted, Logger, sleep, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../chain/index.js";
import {GENESIS_SLOT, ZERO_HASH} from "../../constants/index.js";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/metrics.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../../network/index.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerIdStr} from "../../util/peerId.js";
import {shuffleOne} from "../../util/shuffle.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors.js";
import {verifyBlockProposerSignature} from "./verify.js";


const EPOCH_FLUSH_YIELD_MS = 50; //TODO: remove this since we will change to separate thread for backfill sync.
// Maximum failed requests before disconnecting a peer
const MAX_PEER_FAILURES = 5;

export type BackfillSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: BeaconConfig;
  logger: Logger;
  metrics: Metrics | null;
  anchorState: IBeaconStateView;
  signal: AbortSignal;
};

export type BackfillSyncOpts = {
  backfillBatchSize: number;
};

export enum BackfillSyncEvent {
  completed = "BackfillSync-completed",
}

export enum BackfillSyncStatus {
  pending = "pending",
  syncing = "syncing",
  completed = "completed",
  aborted = "aborted",
}

// numbers to stored in Prometheus metrics
const syncStatus: {[K in BackfillSyncStatus]: number} = {
  [BackfillSyncStatus.aborted]: 0,
  [BackfillSyncStatus.pending]: 1,
  [BackfillSyncStatus.syncing]: 2,
  [BackfillSyncStatus.completed]: 3,
};

type BackfillSyncEvents = {
  [BackfillSyncEvent.completed]: (oldestSlotSynced: Slot) => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

// per peer metadata; we should record this to recognize bad peer
// TODO: or maybe peer manager already manage this?
type PeerMeta = {
  failedRequests: number;
};

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  private status: BackfillSyncStatus = BackfillSyncStatus.pending;
  private anchorRoot: Root;
  private anchorSlot: Slot;
  // collects blocks fo the current epoch.
  private epochBuffer: SignedBeaconBlock[] = [];

  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly network: INetwork;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly metrics: Metrics | null;

  private processor = new ItTrigger();
  private peers = new Map<PeerIdStr, PeerMeta>();
  private signal: AbortSignal;

  constructor(modules: BackfillSyncModules, anchorRoot: Root, anchorSlot: Slot) {
    super();

    this.anchorRoot = anchorRoot;
    this.anchorSlot = anchorSlot;

    this.chain = modules.chain;
    this.db = modules.db;
    this.network = modules.network;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.processor = new ItTrigger();
    this.peers = new Map<PeerIdStr, PeerMeta>();
    this.signal = modules.signal;

    this.network.events.on(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);

    this.sync()
      .then((oldestSlotSynced) => {
        if (this.status !== BackfillSyncStatus.completed) {
          throw new ErrorAborted(`Invalid BackfillSyncStatus at completion: status = ${this.status}`);
        }
        this.emit(BackfillSyncEvent.completed, oldestSlotSynced);
        this.logger.info("BackfillSync completed", {oldestSlotSynced});
        this.close();
      })
      .catch((e) => {
        if (!(e instanceof ErrorAborted)) {
          this.logger.error("BackfillSync processor error", e);
        }
        this.status = BackfillSyncStatus.aborted;
        this.close();
      });

    const metrics = this.metrics;
    if (metrics) {
      metrics.backfillSync.status.addCollect(() => metrics.backfillSync.status.set(syncStatus[this.status]));
      metrics.backfillSync.backfilledTillSlot.addCollect(() =>
        metrics.backfillSync.backfilledTillSlot.set(this.anchorSlot)
      );
    }
  }

  /**
   * Initialize backfill sync from anchor state and DB.
   * Checks BackfilledRange to resume from a previous session.
   */
  static async init(opts: BackfillSyncOpts, modules: BackfillSyncModules): Promise<BackfillSync> {
    const {anchorState, db, logger} = modules;

    const {checkpoint: anchorCp} = anchorState.computeAnchorCheckpoint();
    const anchorSlot = anchorState.latestBlockHeader.slot;
    const anchorEpoch = computeEpochAtSlot(anchorSlot);

    const backfilledRange = await db.backfilledRange.get();
    let startRoot: Root;
    let startSlot: Slot;

    if (backfilledRange && backfilledRange.beginningEpoch === anchorEpoch) {
      // resume from previous session
      const resumeEpoch = backfilledRange.endingEpoch;
      const resumeSlot = resumeEpoch * SLOTS_PER_EPOCH;

      const boundaryBlock = await db.blockArchive.get(resumeSlot);
      if (boundaryBlock) {
        startRoot = boundaryBlock.message.parentRoot;
        startSlot = resumeSlot;
        logger.info("Resuming backfill sync from previous session", {
          resumeEpoch,
          resumeSlot,
          beginningEpoch: backfilledRange.beginningEpoch,
        });
      } else {
        startRoot = anchorCp.root;
        startSlot = anchorSlot;
        logger.warn("BackfilledRange exists but boundary block missing, starting fresh", {
          resumeEpoch,
        });
      }
    } else {
      // fresh backfill
      startRoot = anchorCp.root;
      startSlot = anchorSlot;

      await db.backfilledRange.put({
        beginningEpoch: anchorEpoch,
        endingEpoch: 0,
      });

      logger.info("Starting fresh backfill sync", {
        anchorSlot,
        anchorEpoch,
        anchorRoot: toRootHex(anchorCp.root),
      });
    }
    return new BackfillSync(modules, startRoot, startSlot);
  }

  private async sync(): Promise<Slot> {
    this.processor.trigger();

    for await (const _ of this.processor) {
      if (this.status === BackfillSyncStatus.aborted) break;

      // Reached the chain root: anchorRoot becomes ZERO_HASH only as the parentRoot of
      // the genesis block, so there is nothing left to fetch — flush and complete.
      if (ssz.Root.equals(this.anchorRoot, ZERO_HASH)) {
        if (this.epochBuffer.length > 0) {
          const bufferEpoch = computeEpochAtSlot(this.epochBuffer[0].message.slot);
          await this.flushEpoch(bufferEpoch);
        }
        this.status = BackfillSyncStatus.completed;
        return this.anchorSlot;
      }

      this.status = BackfillSyncStatus.syncing;

      const peer = this.pickPeer();
      if (!peer) {
        this.status = BackfillSyncStatus.pending;
        this.logger.debug("BackfillSync: no eligible peers, waiting");
        continue;
      }
      try {
        // how could they fetch a block via root?
        const [block] = await this.network.sendBeaconBlocksByRoot(peer, [this.anchorRoot]);

        if (!block) {
          throw new BackfillSyncError({
            code: BackfillSyncErrorCode.MISSING_BLOCK,
            root: this.anchorRoot,
            peerId: peer as unknown as PeerId,
          });
        }
        // verify block root
        const blockRoot = this.config.getForkTypes(block.message.slot).BeaconBlock.hashTreeRoot(block.message);
        if (!ssz.Root.equals(blockRoot, this.anchorRoot)) {
          throw new BackfillSyncError({code: BackfillSyncErrorCode.NOT_ANCHORED});
        }

        if (block.message.slot !== GENESIS_SLOT) {
          await verifyBlockProposerSignature(this.config, this.chain.bls, [block]);
        }

        const blockEpoch = computeEpochAtSlot(block.message.slot);

        // Flush buffered blocks from the previous (higher) epoch before appending.
        // Comparing against the buffer's epoch (rather than epochAt(slot-1)) handles
        // skipped slots at epoch boundaries — e.g. walk 97→95 with slot 96 missing.
        if (this.epochBuffer.length > 0) {
          const bufferEpoch = computeEpochAtSlot(this.epochBuffer[0].message.slot);
          if (bufferEpoch !== blockEpoch) {
            await this.flushEpoch(bufferEpoch);
          }
        }

        this.epochBuffer.push(block);
        this.anchorRoot = block.message.parentRoot;
        this.anchorSlot = block.message.slot;

        // After genesis, parentRoot is ZERO_HASH and the loop's top-of-iteration
        // check handles flush+complete; skip the already-filled lookahead here.
        if (block.message.slot !== GENESIS_SLOT) {
          const nextEpoch = computeEpochAtSlot(block.message.slot - 1);
          if (nextEpoch !== blockEpoch) {
            const existingState = await this.db.backfillState.get(nextEpoch);
            if (existingState?.hasBlock) {
              this.logger.info("Skipping already-filled epoch", {epoch: nextEpoch});
              await this.skipFilledEpochs(nextEpoch);
            }
          }
        }
      } catch (e) {
        if (e instanceof BackfillSyncError) {
          switch (e.type.code) {
            case BackfillSyncErrorCode.NOT_ANCHORED:
            case BackfillSyncErrorCode.INVALID_SIGNATURE:
            case BackfillSyncErrorCode.MISSING_BLOCK:
              this.onPeerRequestFailed(peer);
              this.logger.warn("BackfillSync peer request failed", {code: e.type.code, peer});
              break;
            case BackfillSyncErrorCode.INTERNAL_ERROR:
              this.status = BackfillSyncStatus.aborted;
              this.logger.error("backfillsync error", {}, e);
              break;
          }
        } else {
          this.logger.error("BackfillSync error", {}, e as Error);
        }

        if (this.status === BackfillSyncStatus.aborted) break;
      }
      this.processor.trigger();
    }

    throw new ErrorAborted("BackfillSync");
  }

  // storing buffered blocks, update the backfill range.
  private async flushEpoch(epoch: Epoch): Promise<void> {
    if (this.epochBuffer.length === 0) return;

    const puts = this.epochBuffer.map((block) => ({
      key: block.message.slot,
      value: block,
    }));
    await this.db.blockArchive.batchPut(puts);

    await this.db.backfillState.put(epoch, {
      hasBlock: true,
      hasBlobs: null, // TODO: add blob backfills in the future
      columnIndices: null,
    });

    const range = await this.db.backfilledRange.get();
    if (range) {
      await this.db.backfilledRange.put({
        beginningEpoch: range.beginningEpoch,
        endingEpoch: epoch,
      });
    }

    this.logger.verbose("Flushed epoch to DB", {
      epoch,
      blocks: this.epochBuffer.length,
    });

    this.epochBuffer = [];

    await sleep(EPOCH_FLUSH_YIELD_MS, this.signal);
  }

  // finds where to resume after skipping over the filled epochs.
  // | epoch | 0 .. 4   |  5..6  |   7    | 8 .. 9 |   10   |
  // |       |  xfilled | filled | filled |   gap  | anchor |
  // skipFilledEpochs(7) => sync resumes from epoch 4
  private async skipFilledEpochs(startEpoch: Epoch): Promise<void> {
    let epoch = startEpoch;

    while (epoch > 0) {
      const state = await this.db.backfillState.get(epoch);
      if (!state?.hasBlock) break;
      epoch--;
    }

    if (epoch < startEpoch) {
      const bottomSlot = (epoch + 1) * SLOTS_PER_EPOCH;
      const blocks = await this.db.blockArchive.values({
        gte: bottomSlot,
        limit: 1,
      });

      if (blocks.length > 0) {
        this.anchorRoot = blocks[0].message.parentRoot;
        this.anchorSlot = blocks[0].message.slot;
        this.logger.info("Skipped filled epochs", {
          from: startEpoch,
          to: epoch + 1,
          resumeSlot: this.anchorSlot,
        });
      }
    }
  }

  private addPeer = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    this.logger.debug("BackfillSync: peer connected", {peer: data.peer});
    this.peers.set(data.peer, {failedRequests: 0});
    this.processor.trigger();
  };

  private removePeer = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    this.peers.delete(data.peer);
  };

  // TODO: should we stick to one first and switch when it failed?
  private pickPeer(): PeerIdStr | null {
    const eligiblePeers = Array.from(this.peers.entries())
      .filter(([_, meta]) => meta.failedRequests < MAX_PEER_FAILURES)
      .map(([id]) => id);
    return shuffleOne(eligiblePeers) ?? null;
  }

  private onPeerRequestFailed(peer: PeerIdStr): void {
    const meta = this.peers.get(peer);
    if (meta) {
      meta.failedRequests++;
      if (meta.failedRequests >= MAX_PEER_FAILURES) {
        this.logger.warn("BackfillSync: disconnecting peer after too many failures", {peer});
        this.network.reportPeer(peer, PeerAction.LowToleranceError, "BackfillSyncFailures");
      }
    }
  }

  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
    this.epochBuffer = [];
    this.peers.clear();
  }
}
