import {EventEmitter} from "node:events";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks, computeAnchorCheckpoint} from "@lodestar/state-transition";
import {Root, SignedBeaconBlock, Slot, WithBytes, fulu, phase0} from "@lodestar/types";
import {ErrorAborted, Logger, prettyPrintIndices, toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {Metrics} from "../../../metrics/metrics.js";
import {INetwork, NetworkEvent, NetworkEventData, PeerAction} from "../../../network/index.js";
import {PeerSyncMeta} from "../../../network/peers/peersData.js";
import {ItTrigger} from "../../../util/itTrigger.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {BackfillSyncError, BackfillSyncErrorCode} from "../errors.ts";
import {BackfillBlock, BackfillBlockHeader, verifyBlockSequence} from "../verify.js";

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

type BackFillSyncAnchor =
  | {
      anchorBlock: SignedBeaconBlock;
      anchorBlockRoot: Root;
      anchorSlot: Slot;
      lastBackSyncedBlock: BackfillBlock;
    }
  | {anchorBlock: null; anchorBlockRoot: Root; anchorSlot: null; lastBackSyncedBlock: BackfillBlock}
  | {anchorBlock: null; anchorBlockRoot: Root; anchorSlot: Slot; lastBackSyncedBlock: null};

// Updating peer score:
// We can update it on certain events, such as request fulfilled, batch successfully imported, response times.
type PeerBackfillSyncMeta = PeerSyncMeta & {
  score: number;
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
  private peersMeta: Map<PeerIdStr, PeerBackfillSyncMeta>;

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
    const anchorSlot = anchorState.latestBlockHeader.slot;
    const syncAnchor = {
      anchorBlock: null,
      anchorBlockRoot: anchorCp.root,
      anchorSlot,
      lastBackSyncedBlock: null,
    };

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
      iterationCount++;

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

        // send beacon_blocks_by_range request
        // validate blocks
        // store blocks in db blockarchive
        // update lastBackSyncedBlock
        // update BackfillRange and BackfillState
        // update earliestAvailableSlot
      } catch (error) {
        this.logger.error("Caught Error: ", {
          error: (error as Error).message,
          errorStack: (error as Error).stack,
        });
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
