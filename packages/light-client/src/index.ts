import mitt from "mitt";
import {AbortController} from "@chainsafe/abort-controller";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {getClient, Api, routes} from "@chainsafe/lodestar-api";
import {altair, phase0, RootHex, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {createIBeaconConfig, IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {isErrorAborted, sleep} from "@chainsafe/lodestar-utils";
import {fromHexString, JsonPath, toHexString} from "@chainsafe/ssz";
import {getCurrentSlot, slotWithFutureTolerance, timeUntilNextEpoch} from "./utils/clock.js";
import {isBetterUpdate, LightclientUpdateStats} from "./utils/update.js";
import {deserializeSyncCommittee, isEmptyHeader, sumBits} from "./utils/utils.js";
import {pruneSetToMax} from "./utils/map.js";
import {isValidMerkleBranch} from "./utils/verifyMerkleBranch.js";
import {SyncCommitteeFast} from "./types.js";
import {chunkifyInclusiveRange} from "./utils/chunkify.js";
import {LightclientEmitter, LightclientEvent} from "./events.js";
import {assertValidSignedHeader, assertValidLightClientUpdate, activeHeader} from "./validation.js";
import {GenesisData} from "./networks.js";
import {getLcLoggerConsole, ILcLogger} from "./utils/logger.js";
import {computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot, computeEpochAtSlot} from "./utils/clock.js";

// Re-export event types
export {LightclientEvent} from "./events.js";

export type LightclientInitArgs = {
  config: IChainForkConfig;
  logger?: ILcLogger;
  genesisData: {
    genesisTime: number;
    genesisValidatorsRoot: RootHex | Uint8Array;
  };
  beaconApiUrl: string;
  snapshot: {
    header: phase0.BeaconBlockHeader;
    currentSyncCommittee: altair.SyncCommittee;
  };
};

/** Provides some protection against a server client sending header updates too far away in the future */
const MAX_CLOCK_DISPARITY_SEC = 12;
/** Prevent responses that are too big and get truncated. No specific reasoning for 32 */
const MAX_PERIODS_PER_REQUEST = 32;
/** For mainnet preset 8 epochs, for minimal preset `EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2` */
const LOOKAHEAD_EPOCHS_COMMITTEE_SYNC = Math.min(8, Math.ceil(EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2));
/** Prevent infinite loops caused by sync errors */
const ON_ERROR_RETRY_MS = 1000;
/** Persist only the current and next sync committee */
const MAX_STORED_SYNC_COMMITTEES = 2;
/** Persist current previous and next participation */
const MAX_STORED_PARTICIPATION = 3;
/**
 * From https://notes.ethereum.org/@vbuterin/extended_light_client_protocol#Optimistic-head-determining-function
 */
const SAFETY_THRESHOLD_FACTOR = 2;

const CURRENT_SYNC_COMMITTEE_INDEX = 22;
const CURRENT_SYNC_COMMITTEE_DEPTH = 5;

enum RunStatusCode {
  started,
  syncing,
  stopped,
}
type RunStatus =
  | {code: RunStatusCode.started; controller: AbortController}
  | {code: RunStatusCode.syncing}
  | {code: RunStatusCode.stopped};

/**
 * Server-based Lightclient. Current architecture diverges from the spec's proposed updated splitting them into:
 * - Sync period updates: To advance to the next sync committee
 * - Header updates: To get a more recent header signed by a known sync committee
 *
 * To stay synced to the current sync period it needs:
 * - GET lightclient/committee_updates at least once per period.
 *
 * To get continuous header updates:
 * - subscribe to SSE type lightclient_update
 *
 * To initialize, it needs:
 * - GenesisData: To initialize the clock and verify signatures
 *   - For known networks it's hardcoded in the source
 *   - For unknown networks it can be provided by the user with a manual input
 *   - For unknown test networks it can be queried from a trusted node at GET beacon/genesis
 * - `beaconApiUrl`: To connect to a trustless beacon node
 * - `LightclientStore`: To have an initial trusted SyncCommittee to start the sync
 *   - For new lightclient instances, it can be queries from a trustless node at GET lightclient/snapshot
 *   - For existing lightclient instances, it should be retrieved from storage
 *
 * When to trigger a committee update sync:
 *
 *  period 0         period 1         period 2
 * -|----------------|----------------|----------------|-> time
 *              | now
 *               - active current_sync_committee
 *               - known next_sync_committee, signed by current_sync_committee
 *
 * - No need to query for period 0 next_sync_committee until the end of period 0
 * - During most of period 0, current_sync_committe known, next_sync_committee unknown
 * - At the end of period 0, get a sync committe update, and populate period 1's committee
 *
 * syncCommittees: Map<SyncPeriod, SyncCommittee>, limited to max of 2 items
 */
export class Lightclient {
  readonly api: Api;
  readonly emitter: LightclientEmitter = mitt();

  readonly config: IBeaconConfig;
  readonly logger: ILcLogger;
  readonly genesisValidatorsRoot: Uint8Array;
  readonly genesisTime: number;
  readonly beaconApiUrl: string;

  /**
   * Map of period -> SyncCommittee. Uses a Map instead of spec's current and next fields to allow more flexible sync
   * strategies. In this case the Lightclient won't attempt to fetch the next SyncCommittee until the end of the
   * current period. This Map approach is also flexible in case header updates arrive in mixed ordering.
   */
  readonly syncCommitteeByPeriod = new Map<SyncPeriod, LightclientUpdateStats & SyncCommitteeFast>();
  /**
   * Register participation by period. Lightclient only accepts updates that have sufficient participation compared to
   * previous updates with a factor of SAFETY_THRESHOLD_FACTOR.
   */
  private readonly maxParticipationByPeriod = new Map<SyncPeriod, number>();
  private head: {
    participation: number;
    header: phase0.BeaconBlockHeader;
    blockRoot: RootHex;
  };

  private status: RunStatus = {code: RunStatusCode.stopped};

  constructor({config, logger, genesisData, beaconApiUrl, snapshot}: LightclientInitArgs) {
    this.genesisTime = genesisData.genesisTime;
    this.genesisValidatorsRoot =
      typeof genesisData.genesisValidatorsRoot === "string"
        ? fromHexString(genesisData.genesisValidatorsRoot)
        : genesisData.genesisValidatorsRoot;

    this.config = createIBeaconConfig(config, this.genesisValidatorsRoot);
    this.logger = logger ?? getLcLoggerConsole();

    this.beaconApiUrl = beaconApiUrl;
    this.api = getClient(config, {baseUrl: beaconApiUrl});

    const periodCurr = computeSyncPeriodAtSlot(snapshot.header.slot);
    this.syncCommitteeByPeriod.set(periodCurr, {
      isFinalized: false,
      participation: 0,
      slot: periodCurr * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH,
      ...deserializeSyncCommittee(snapshot.currentSyncCommittee),
    });

    this.head = {
      participation: 0,
      header: snapshot.header,
      blockRoot: toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(snapshot.header)),
    };
  }

  static async initializeFromCheckpointRoot({
    config,
    logger,
    beaconApiUrl,
    genesisData,
    checkpointRoot,
  }: {
    config: IChainForkConfig;
    logger?: ILcLogger;
    beaconApiUrl: string;
    genesisData: GenesisData;
    checkpointRoot: phase0.Checkpoint["root"];
  }): Promise<Lightclient> {
    const api = getClient(config, {baseUrl: beaconApiUrl});

    // Fetch snapshot with proof at the trusted block root
    const {data: snapshotWithProof} = await api.lightclient.getSnapshot(toHexString(checkpointRoot));
    const {header, currentSyncCommittee, currentSyncCommitteeBranch} = snapshotWithProof;

    // verify the response matches the requested root
    const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    if (!ssz.Root.equals(checkpointRoot, headerRoot)) {
      throw new Error("Snapshot header does not match trusted checkpoint");
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
      throw Error("Snapshot sync committees proof does not match trusted checkpoint");
    }

    return new Lightclient({
      config,
      logger,
      beaconApiUrl,
      genesisData,
      snapshot: snapshotWithProof,
    });
  }

  start(): void {
    this.runLoop().catch((e) => {
      this.logger.error("Error on runLoop", {}, e as Error);
    });
  }

  stop(): void {
    if (this.status.code !== RunStatusCode.started) return;

    this.status.controller.abort();
    this.status = {code: RunStatusCode.stopped};
  }

  // Embed lightweigth clock. The epoch cycles are handled with `this.runLoop()`
  get currentSlot(): number {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  getHead(): phase0.BeaconBlockHeader {
    return this.head.header;
  }

  /** Returns header since head may change during request */
  async getHeadStateProof(paths: JsonPath[]): Promise<{proof: TreeOffsetProof; header: phase0.BeaconBlockHeader}> {
    const header = this.head.header;
    const stateId = toHexString(header.stateRoot);
    const res = await this.api.lightclient.getStateProof(stateId, paths);
    return {
      proof: res.data as TreeOffsetProof,
      header,
    };
  }

  async sync(fromPeriod: SyncPeriod, toPeriod: SyncPeriod): Promise<void> {
    const periodRanges = chunkifyInclusiveRange(fromPeriod, toPeriod, MAX_PERIODS_PER_REQUEST);

    for (const [fromPeriodRng, toPeriodRng] of periodRanges) {
      const {data: updates} = await this.api.lightclient.getCommitteeUpdates(fromPeriodRng, toPeriodRng);
      for (const update of updates) {
        this.processSyncCommitteeUpdate(update);
        const headPeriod = computeSyncPeriodAtSlot(update.attestedHeader.slot);
        this.logger.debug(`processed sync update for period ${headPeriod}`);
        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private async runLoop(): Promise<void> {
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

        // Fetch latest head to prevent a potential 12 seconds lag between syncing and getting the first head,
        // Don't retry, this is a non-critical UX improvement
        try {
          const {data: latestHeadUpdate} = await this.api.lightclient.getHeadUpdate();
          this.processHeaderUpdate(latestHeadUpdate);
        } catch (e) {
          this.logger.error("Error fetching getHeadUpdate", {currentPeriod}, e as Error);
        }
      }

      // After successfully syncing, track head if not already
      if (this.status.code !== RunStatusCode.started) {
        const controller = new AbortController();
        this.status = {code: RunStatusCode.started, controller};
        this.logger.debug("Started tracking the head");

        // Subscribe to head updates over SSE
        // TODO: Use polling for getHeadUpdate() is SSE is unavailable
        this.api.events.eventstream([routes.events.EventType.lightclientHeaderUpdate], controller.signal, this.onSSE);
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

  private onSSE = (event: routes.events.BeaconEvent): void => {
    try {
      switch (event.type) {
        case routes.events.EventType.lightclientHeaderUpdate:
          this.processHeaderUpdate(event.message);
          break;

        default:
          throw Error(`Unknown event ${event.type}`);
      }
    } catch (e) {
      this.logger.error("Error on onSSE", {}, e as Error);
    }
  };

  /**
   * Processes new header updates in only known synced sync periods.
   * This headerUpdate may update the head if there's enough participation.
   */
  private processHeaderUpdate(headerUpdate: routes.events.LightclientHeaderUpdate): void {
    const {attestedHeader: header, syncAggregate} = headerUpdate;

    // Prevent registering updates for slots to far ahead
    if (header.slot > slotWithFutureTolerance(this.config, this.genesisTime, MAX_CLOCK_DISPARITY_SEC)) {
      throw Error(`header.slot ${header.slot} is too far in the future, currentSlot: ${this.currentSlot}`);
    }

    const period = computeSyncPeriodAtSlot(header.slot);
    const syncCommittee = this.syncCommitteeByPeriod.get(period);
    if (!syncCommittee) {
      // TODO: Attempt to fetch committee update for period if it's before the current clock period
      throw Error(`No syncCommittee for period ${period}`);
    }

    const headerBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    const headerBlockRootHex = toHexString(headerBlockRoot);

    assertValidSignedHeader(this.config, syncCommittee, syncAggregate, headerBlockRoot, header.slot);

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
      header.slot > this.head.header.slot ||
      // Replace same slot head
      (header.slot === this.head.header.slot && participation > this.head.participation)
    ) {
      // TODO: Do metrics for each case (advance vs replace same slot)
      const prevHead = this.head;
      this.head = {header, participation, blockRoot: headerBlockRootHex};

      // This is not an error, but a problematic network condition worth knowing about
      if (header.slot === prevHead.header.slot && prevHead.blockRoot !== headerBlockRootHex) {
        this.logger.warn("Head update on same slot", {
          prevHeadSlot: prevHead.header.slot,
          prevHeadRoot: prevHead.blockRoot,
        });
      }
      this.logger.info("Head updated", {
        slot: header.slot,
        root: headerBlockRootHex,
      });

      // Emit to consumers
      this.emitter.emit(LightclientEvent.head, header);
    } else {
      this.logger.debug("Received valid head update did not update head", {
        currentHead: `${this.head.header.slot} ${this.head.blockRoot}`,
        eventHead: `${header.slot} ${headerBlockRootHex}`,
      });
    }
  }

  /**
   * Process SyncCommittee update, signed by a known previous SyncCommittee.
   * SyncCommittee can be updated at any time, not strictly at the period borders.
   *
   *  period 0         period 1         period 2
   * -|----------------|----------------|----------------|-> time
   *                   | now
   *                     - active current_sync_committee: period 0
   *                     - known next_sync_committee, signed by current_sync_committee
   */
  private processSyncCommitteeUpdate(update: altair.LightClientUpdate): void {
    // Prevent registering updates for slots too far in the future
    const updateSlot = activeHeader(update).slot;
    if (updateSlot > slotWithFutureTolerance(this.config, this.genesisTime, MAX_CLOCK_DISPARITY_SEC)) {
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
      this.emitter.emit(LightclientEvent.committee, updatePeriod);
      this.syncCommitteeByPeriod.set(nextPeriod, {
        ...newNextSyncCommitteeStats,
        ...deserializeSyncCommittee(update.nextSyncCommittee),
      });
      pruneSetToMax(this.syncCommitteeByPeriod, MAX_STORED_SYNC_COMMITTEES);
      // TODO: Metrics, updated syncCommittee
    }
  }
}
