import {EventEmitter} from "events";
import {PeerId} from "@libp2p/interface-peer-id";
import {StrictEventEmitter} from "strict-event-emitter-types";
import {IBeaconConfig} from "@lodestar/config";
import {altair, phase0, Root, RootHex, Slot, ssz, SyncPeriod} from "@lodestar/types";
import {ErrorAborted, ILogger, isErrorAborted, pruneSetToMax, sleep} from "@lodestar/utils";

import {init as initBls} from "@chainsafe/bls/switchable";
import {LightClientBootstrap, LightClientUpdate} from "@lodestar/types/altair";
import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  ForkName,
  MAX_REQUEST_LIGHT_CLIENT_UPDATES,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {toHexString} from "@chainsafe/ssz";
import {GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {IBeaconChain} from "../../chain/index.js";
import {IBeaconDb} from "../../db/index.js";
import {GossipType, INetwork, NetworkEvent} from "../../network/index.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerSet} from "../../util/peerMap.js";
import {IMetrics} from "../../metrics/metrics";
import {DEFAULT_ENCODING} from "../../network/gossip/constants.js";
import {
  assertValidFinalityProof,
  assertValidLightClientUpdate,
  assertValidSignedHeader,
  computeEpochAtSlot,
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
  deserializeSyncCommittee,
  getCurrentSlot,
  isBetterUpdate,
  isEmptyHeader,
  isNode,
  isValidMerkleBranch,
  LightclientUpdateStats,
  slotWithFutureTolerance,
  sumBits,
  SyncCommitteeFast,
  timeUntilNextEpoch,
} from "./lightSyncUtils.js";

/** Provides some protection against a server client sending header updates too far away in the future */
const MAX_CLOCK_DISPARITY_SEC = 12;
const CURRENT_SYNC_COMMITTEE_INDEX = 22;
const CURRENT_SYNC_COMMITTEE_DEPTH = 5;
/** Persist only the current and next sync committee */
const MAX_STORED_SYNC_COMMITTEES = 2;
/** For mainnet preset 8 epochs, for minimal preset `EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2` */
const LOOKAHEAD_EPOCHS_COMMITTEE_SYNC = Math.min(8, Math.ceil(EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2));
/** Persist current previous and next participation */
const MAX_STORED_PARTICIPATION = 3;
const SAFETY_THRESHOLD_FACTOR = 2;
const ON_ERROR_RETRY_MS = 1000;

export type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: RootHex | Uint8Array;
};

enum RunStatusCode {
  started,
  syncing,
  stopped,
}
type RunStatus =
  | {code: RunStatusCode.started; controller: AbortController}
  | {code: RunStatusCode.syncing}
  | {code: RunStatusCode.stopped};

export type LightSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: IBeaconConfig;
  logger: ILogger;
  metrics: IMetrics | null;
  signal: AbortSignal;
};

export enum LightSyncEvent {
  completed = "LightSync-completed",
}

export enum BootstrapStatus {
  pending = "pending",
  failed = "failed",
  done = "done",
  successful = "successful",
}

type LightSyncEvents = {
  [LightSyncEvent.completed]: (
    /** Oldest slot synced */
    oldestSlotSynced: Slot
  ) => void;
};

type LightClientArgs = {
  checkpointRoot: Root;
  genesisData: GenesisData;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, LightSyncEvents>;

export class LightSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  private readonly checkpointRoot: Root;
  private lightClientBootstrap: LightClientBootstrap | undefined;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  // Probably don't need db as a light client
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetrics | null;
  readonly genesisTime: number;

  readonly syncCommitteeByPeriod = new Map<SyncPeriod, LightclientUpdateStats & SyncCommitteeFast>();

  private status: RunStatus = {code: RunStatusCode.stopped};
  private readonly maxParticipationByPeriod = new Map<SyncPeriod, number>();
  private head: {
    participation: number;
    header: phase0.BeaconBlockHeader;
    blockRoot: RootHex;
  } = {
    participation: 0,
    header: ssz.phase0.BeaconBlockHeader.defaultValue(),
    blockRoot: toHexString(ssz.Root.defaultValue()),
  };

  private finalized: {
    participation: number;
    header: phase0.BeaconBlockHeader;
    blockRoot: RootHex;
  } | null = null;

  private processor = new ItTrigger();
  private peers = new PeerSet();
  private signal: AbortSignal;

  constructor(opts: LightClientArgs, modules: LightSyncModules) {
    super();

    this.checkpointRoot = opts.checkpointRoot;
    this.genesisTime = opts.genesisData.genesisTime;
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.metrics = modules.metrics;

    this.network.events.on(NetworkEvent.peerConnected, this.onNewPeer);
    this.network.events.on(NetworkEvent.peerDisconnected, this.removePeer);
    this.signal = modules.signal;
  }

  get currentSlot(): number {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  static async init<T extends LightSync = LightSync>(opts: LightClientArgs, modules: LightSyncModules): Promise<T> {
    // Initialize the BLS implementation. This may requires intializing the WebAssembly instance
    // so why it's a an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    return new this(opts, modules) as T;
  }

  /** Throw / return all AsyncGenerators */
  close(): void {
    this.network.events.off(NetworkEvent.peerConnected, this.onNewPeer);
    this.network.events.off(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  start(): void {
    this.runLoop().catch((e) => {
      this.logger.error("Error on runLoop", {}, e as Error);
    });
  }

  async sync(fromPeriod: SyncPeriod, toPeriod: SyncPeriod): Promise<void> {
    // Initialize the BLS implementation. This may requires intializing the WebAssembly instance
    // so why it's a an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    const knownPeers = this.peers.values();
    if (knownPeers.length > 0) {
      let randomIndex = Math.floor(Math.random() * knownPeers.length);
      let peer = knownPeers[randomIndex];
      const count = toPeriod + 1 - fromPeriod;
      let updates: LightClientUpdate[] = [];

      while (updates.length === 0) {
        try {
          // TODO DA chukify
          // have a cap on the attempt
          updates = await this.network.reqResp.lightClientUpdate(peer, {startPeriod: fromPeriod, count});
        } catch (e) {
          // TODO DA improve. Now just try another random peer
          // keep a track of the peer and ranges not fetched to be retried later
          randomIndex = Math.floor(Math.random() * knownPeers.length);
          peer = knownPeers[randomIndex];
          this.logger.error("error fetching lightclientupdate", {}, e as Error);
        }
      }

      // TODO DA distinguish between when there is no valid response and when the peer requested from
      // do not have the data requested
      for (const update of updates) {
        this.processSyncCommitteeUpdate(update);
        const headPeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
        this.logger.debug(`processed sync update for period ${headPeriod}`);
        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private processSyncCommitteeUpdate(update: altair.LightClientUpdate): void {
    // Prevent registering updates for slots too far in the future
    const updateSlot = update.attestedHeader.slot;
    if (updateSlot > slotWithFutureTolerance(this.config, this.genesisTime, MAX_REQUEST_LIGHT_CLIENT_UPDATES)) {
      throw Error(`updateSlot ${updateSlot} is too far in the future, currentSlot ${this.currentSlot}`);
    }

    // Must not rollback periods, since the cache is bounded an older committee could evict the current committee
    const updatePeriod = computeSyncPeriodAtSlot(updateSlot);
    const minPeriod = Math.min(-Infinity, ...this.syncCommitteeByPeriod.keys());
    if (updatePeriod < minPeriod) {
      throw Error(`update must not rollback existing committee at period ${minPeriod}`);
    }

    const syncCommittee = this.syncCommitteeByPeriod.get(updatePeriod);
    if (!syncCommittee) {
      throw Error(`No SyncCommittee for period ${updatePeriod}`);
    }

    assertValidLightClientUpdate(this.config, syncCommittee, update);

    // Store next_sync_committee keyed by next period.
    // Multiple updates could be requested for the same period, only keep the SyncCommittee associated with the best
    // update available, where best is decided by `isBetterUpdate()`
    const nextPeriod = updatePeriod + 1;
    const existingNextSyncCommittee = this.syncCommitteeByPeriod.get(nextPeriod);
    const newNextSyncCommitteeStats: LightclientUpdateStats = {
      isFinalized: !isEmptyHeader(update.finalizedHeader),
      participation: sumBits(update.syncAggregate.syncCommitteeBits),
      slot: updateSlot,
    };

    if (!existingNextSyncCommittee || isBetterUpdate(existingNextSyncCommittee, newNextSyncCommitteeStats)) {
      this.logger.info("Stored SyncCommittee", {nextPeriod, replacedPrevious: existingNextSyncCommittee != null});
      this.syncCommitteeByPeriod.set(nextPeriod, {
        ...newNextSyncCommitteeStats,
        ...deserializeSyncCommittee(update.nextSyncCommittee),
      });
      pruneSetToMax(this.syncCommitteeByPeriod, MAX_STORED_SYNC_COMMITTEES);
      // TODO: Metrics, updated syncCommittee
    }
  }

  private processFinalizedUpdate(finalizedUpdate: altair.LightClientFinalityUpdate): void {
    // Validate sync aggregate of the attested header and other conditions like future update, period etc
    // and may be move head
    this.processOptimisticUpdate(finalizedUpdate);
    assertValidFinalityProof(finalizedUpdate);

    const {finalizedHeader, syncAggregate} = finalizedUpdate;
    const finalizedBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(finalizedHeader);
    const participation = sumBits(syncAggregate.syncCommitteeBits);
    // Maybe update the finalized
    if (
      this.finalized === null ||
      // Advance head
      finalizedHeader.slot > this.finalized.header.slot ||
      // Replace same slot head
      (finalizedHeader.slot === this.finalized.header.slot && participation > this.head.participation)
    ) {
      // TODO: Do metrics for each case (advance vs replace same slot)
      const prevFinalized = this.finalized;
      const finalizedBlockRootHex = toHexString(finalizedBlockRoot);

      this.finalized = {header: finalizedHeader, participation, blockRoot: finalizedBlockRootHex};

      // This is not an error, but a problematic network condition worth knowing about
      if (
        prevFinalized &&
        finalizedHeader.slot === prevFinalized.header.slot &&
        prevFinalized.blockRoot !== finalizedBlockRootHex
      ) {
        this.logger.warn("Finalized update on same slot", {
          prevHeadSlot: prevFinalized.header.slot,
          prevHeadRoot: prevFinalized.blockRoot,
        });
      }
      this.logger.info("Finalized updated", {
        slot: finalizedHeader.slot,
        root: finalizedBlockRootHex,
      });
    } else {
      this.logger.debug("Received valid finalized update did not update finalized", {
        currentHead: `${this.finalized.header.slot} ${this.finalized.blockRoot}`,
        eventHead: `${finalizedHeader.slot} ${finalizedBlockRoot}`,
      });
    }
  }
  private processOptimisticUpdate(headerUpdate: altair.LightClientOptimisticUpdate): void {
    const {attestedHeader, syncAggregate} = headerUpdate;

    // Prevent registering updates for slots to far ahead
    if (attestedHeader.slot > slotWithFutureTolerance(this.config, this.genesisTime, MAX_CLOCK_DISPARITY_SEC)) {
      throw Error(`header.slot ${attestedHeader.slot} is too far in the future, currentSlot: ${this.currentSlot}`);
    }

    const period = computeSyncPeriodAtSlot(attestedHeader.slot);
    const syncCommittee = this.syncCommitteeByPeriod.get(period);
    if (!syncCommittee) {
      // TODO: Attempt to fetch committee update for period if it's before the current clock period
      throw Error(`No syncCommittee for period ${period}`);
    }

    const headerBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(attestedHeader);
    const headerBlockRootHex = toHexString(headerBlockRoot);

    assertValidSignedHeader(this.config, syncCommittee, syncAggregate, headerBlockRoot, attestedHeader.slot);

    // Valid header, check if has enough bits.
    // Only accept headers that have at least half of the max participation seen in this period
    // From spec https://github.com/ethereum/consensus-specs/pull/2746/files#diff-5e27a813772fdd4ded9b04dec7d7467747c469552cd422d57c1c91ea69453b7dR122
    // Take the max of current period and previous period
    const currMaxParticipation = this.maxParticipationByPeriod.get(period) ?? 0;
    const prevMaxParticipation = this.maxParticipationByPeriod.get(period - 1) ?? 0;
    const maxParticipation = Math.max(currMaxParticipation, prevMaxParticipation);
    const minSafeParticipation = Math.floor(maxParticipation / SAFETY_THRESHOLD_FACTOR);

    const participation = sumBits(syncAggregate.syncCommitteeBits);
    if (participation < minSafeParticipation) {
      // TODO: Not really an error, this can happen
      throw Error(`syncAggregate has participation ${participation} less than safe minimum ${minSafeParticipation}`);
    }

    // Maybe register new max participation
    if (participation > maxParticipation) {
      this.maxParticipationByPeriod.set(period, participation);
      pruneSetToMax(this.maxParticipationByPeriod, MAX_STORED_PARTICIPATION);
    }

    // Maybe update the head
    if (
      // Advance head
      attestedHeader.slot > this.head.header.slot ||
      // Replace same slot head
      (attestedHeader.slot === this.head.header.slot && participation > this.head.participation)
    ) {
      // TODO: Do metrics for each case (advance vs replace same slot)
      const prevHead = this.head;
      this.head = {header: attestedHeader, participation, blockRoot: headerBlockRootHex};

      // This is not an error, but a problematic network condition worth knowing about
      if (attestedHeader.slot === prevHead.header.slot && prevHead.blockRoot !== headerBlockRootHex) {
        this.logger.warn("Head update on same slot", {
          prevHeadSlot: prevHead.header.slot,
          prevHeadRoot: prevHead.blockRoot,
        });
      }
      this.logger.info("Head updated", {
        slot: attestedHeader.slot,
        root: headerBlockRootHex,
      });
    } else {
      this.logger.debug("Received valid head update did not update head", {
        currentHead: `${this.head.header.slot} ${this.head.blockRoot}`,
        eventHead: `${attestedHeader.slot} ${headerBlockRootHex}`,
      });
    }
  }

  private async runLoop(): Promise<void> {
    // Initialize the BLS implementation. This may requires intializing the WebAssembly instance
    // so why it's a an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentPeriod = computeSyncPeriodAtSlot(this.currentSlot);
      // Check if we have a sync committee for the current clock period
      if (!this.syncCommitteeByPeriod.has(currentPeriod)) {
        // Stop head tracking
        if (this.status.code === RunStatusCode.started) {
          this.status.controller.abort();
        }

        // Go into sync mode
        this.status = {code: RunStatusCode.syncing};
        const headPeriod = computeSyncPeriodAtSlot(this.head.header.slot);
        this.logger.debug("Syncing", {lastPeriod: headPeriod, currentPeriod});

        try {
          await this.sync(headPeriod, currentPeriod);
          this.logger.debug("Synced", {currentPeriod});
        } catch (e) {
          this.logger.error("Error sync", {}, e as Error);

          // Retry in 1 second
          await new Promise((r) => setTimeout(r, ON_ERROR_RETRY_MS));
          continue;
        }

        // Fetch latest optimistic head to prevent a potential 12 seconds lag between syncing and getting the first head,
        // Don't retry, this is a non-critical UX improvement
        try {
          const peer = this.getPeer();
          if (peer) {
            const latestOptimisticUpdate = await this.network.reqResp.lightClientOptimisticUpdate(peer);
            this.processOptimisticUpdate(latestOptimisticUpdate);
          }
        } catch (e) {
          this.logger.error("Error fetching getLatestHeadUpdate", {currentPeriod}, e as Error);
        }
      }

      // After successfully syncing, track head if not already
      if (this.status.code !== RunStatusCode.started) {
        const controller = new AbortController();
        this.status = {code: RunStatusCode.started, controller};
        this.logger.debug("Started tracking the head");

        // TODO DA Subscribe to head updates over gossip
        this.network.gossip.addEventListener("gossipsub:message", this.onGossipsubMessage.bind(this));
      }

      // When close to the end of a sync period poll for sync committee updates
      // Limit lookahead in case EPOCHS_PER_SYNC_COMMITTEE_PERIOD is configured to be very short

      const currentEpoch = computeEpochAtSlot(this.currentSlot);
      const epochsIntoPeriod = currentEpoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
      // Start fetching updates with some lookahead
      if (EPOCHS_PER_SYNC_COMMITTEE_PERIOD - epochsIntoPeriod <= LOOKAHEAD_EPOCHS_COMMITTEE_SYNC) {
        const period = computeSyncPeriodAtEpoch(currentEpoch);
        try {
          await this.sync(period, period);
        } catch (e) {
          this.logger.error("Error re-syncing period", {period}, e as Error);
        }
      }

      // Wait for the next epoch
      if (this.status.code !== RunStatusCode.started) {
        return;
      } else {
        try {
          await sleep(timeUntilNextEpoch(this.config, this.genesisTime), this.status.controller.signal);
        } catch (e) {
          if (isErrorAborted(e)) {
            return;
          }
          throw e;
        }
      }
    }
  }

  private onGossipsubMessage(event: GossipsubEvents["gossipsub:message"]): void {
    const {msg} = event.detail;

    // TODO DA A better way to resolve forkDigestHex
    const forkDigestHex = this.config.forkName2ForkDigestHex(ForkName.bellatrix);
    const optimisticUpdateTopic = `/eth2/${forkDigestHex}/${GossipType.light_client_optimistic_update}/${DEFAULT_ENCODING}`;
    const finalityUpdateTopic = `/eth2/${forkDigestHex}/${GossipType.light_client_finality_update}/${DEFAULT_ENCODING}`;

    if (msg.topic === optimisticUpdateTopic) {
      this.processOptimisticUpdate(ssz.altair.LightClientOptimisticUpdate.deserialize(msg.data));
    } else if (msg.topic === finalityUpdateTopic) {
      this.processFinalizedUpdate(ssz.altair.LightClientFinalityUpdate.deserialize(msg.data));
    } else {
      this.logger.info("not processing", msg.topic);
    }
  }

  private addPeer = (peerId: PeerId, _peerStatus: phase0.Status): void => {
    // TODO DA suggested checks before adding peers
    // 1. is after altiar
    this.peers.add(peerId);
  };

  private getPeer = (): PeerId | undefined => {
    // TODO DA need to come up with a strategy to select
    // the most suitable peer instead of random selection?
    const peers = this.peers.values();
    if (peers.length === 0) return undefined;

    return peers[Math.floor(Math.random() * peers.length)];
  };

  private attemptBootstrap = async (peerId: PeerId): Promise<BootstrapStatus> => {
    if (this.lightClientBootstrap === undefined) {
      try {
        this.lightClientBootstrap = await this.network.reqResp.lightClientBootstrap(peerId, this.checkpointRoot);
        const {header, currentSyncCommittee, currentSyncCommitteeBranch} = this.lightClientBootstrap;

        // verify the response matches the requested root
        const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
        if (!ssz.Root.equals(this.checkpointRoot, headerRoot)) {
          this.logger.error("Bootstrap header does not match trusted checkpoint");
          return BootstrapStatus.failed;
        }

        // Verify the sync committees
        if (
          !isValidMerkleBranch(
            ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
            currentSyncCommitteeBranch,
            CURRENT_SYNC_COMMITTEE_DEPTH,
            CURRENT_SYNC_COMMITTEE_INDEX,
            header.stateRoot as Uint8Array
          )
        ) {
          this.logger.error("Snapshot sync committees proof does not match trusted checkpoint");
          return BootstrapStatus.failed;
        }

        // we have a validated lightclientbootstap,
        // set head
        this.head = {
          participation: 0,
          header: this.lightClientBootstrap.header,
          blockRoot: toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(this.lightClientBootstrap.header)),
        };
        // set syncommittee for current period
        const currentPeriod = computeSyncPeriodAtSlot(this.lightClientBootstrap.header.slot);
        this.syncCommitteeByPeriod.set(currentPeriod, {
          isFinalized: false,
          participation: 0,
          slot: currentPeriod * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH,
          ...deserializeSyncCommittee(this.lightClientBootstrap.currentSyncCommittee),
        });

        return BootstrapStatus.successful;
      } catch (e) {
        this.logger.error("Error getting lightClientBootstrap", {}, e as Error);
        return BootstrapStatus.failed;
      }
    } else {
      return BootstrapStatus.done;
    }
  };

  private onNewPeer = async (peerId: PeerId, peerStatus: phase0.Status): Promise<void> => {
    this.addPeer(peerId, peerStatus);
    const bootstrapStatus = await this.attemptBootstrap(peerId);
    if (BootstrapStatus.successful === bootstrapStatus) {
      // start syncing
      this.start();
    }
  };

  private removePeer = (peerId: PeerId): void => {
    this.peers.delete(peerId);
  };
}
