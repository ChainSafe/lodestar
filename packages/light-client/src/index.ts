import mitt from "mitt";
import {AbortController} from "@chainsafe/abort-controller";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {getClient, Api, routes} from "@chainsafe/lodestar-api";
import {altair, Epoch, phase0, RootHex, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeOffsetProof} from "@chainsafe/persistent-merkle-tree";
import {fromHexString, Path, toHexString} from "@chainsafe/ssz";
import {Clock, IClock} from "./utils/clock";
import {isBetterUpdate, LightclientUpdateStats} from "./utils/update";
import {deserializeSyncCommittee, isEmptyHeader, sumBits} from "./utils/utils";
import {pruneSetToMax} from "./utils/map";
import {isValidSyncCommitteesBranch} from "./utils/verifyMerkleBranch";
import {SyncCommitteeFast} from "./types";
import {chunkifyInclusiveRange} from "./utils/chunkify";
import {LightclientEmitter, LightclientEvent} from "./events";
import {assertValidSignedHeader, assertValidLightClientUpdate} from "./validation";
import {GenesisData} from "./networks";
import {getLcLoggerConsole, ILcLogger} from "./utils/logger";

// Re-export event types
export {LightclientEvent} from "./events";

export type LightclientInitArgs = {
  config: IChainForkConfig;
  logger?: ILcLogger;
  genesisData: {
    genesisTime: number;
    genesisValidatorsRoot: RootHex | Uint8Array;
  };
  beaconApiUrl: string;
  snapshot: altair.LightClientSnapshot;
};

const MAX_CLOCK_DISPARITY_SEC = 12;
const MAX_PERIODS_PER_REQUEST = 32;
const LOOKAHEAD_EPOCHS_COMMITTEE_SYNC = 8;
const ON_ERROR_RETRY_MS = 1000;
const MAX_STORED_SYNC_COMMITTEES = 2;
/**
 * From https://notes.ethereum.org/@vbuterin/extended_light_client_protocol#Optimistic-head-determining-function
 */
const SAFETY_THRESHOLD_FACTOR = 2;

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
 * - GET lightclient/best_updates at least once per period.
 *
 * To get continuous header updates:
 * - subscribe to SSE
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
 *
 */
export class Lightclient {
  readonly api: Api;
  readonly emitter: LightclientEmitter = mitt();

  readonly config: IChainForkConfig;
  readonly logger: ILcLogger;
  readonly clock: IClock;
  readonly genesisValidatorsRoot: Uint8Array;
  readonly beaconApiUrl: string;

  readonly syncCommitteeByPeriod = new Map<SyncPeriod, LightclientUpdateStats & SyncCommitteeFast>();
  private readonly maxParticipationByPeriod = new Map<SyncPeriod, number>();
  private head: {
    participation: number;
    header: phase0.BeaconBlockHeader;
    blockRoot: RootHex;
  };

  private status: RunStatus = {code: RunStatusCode.stopped};

  constructor({config, logger, genesisData, beaconApiUrl, snapshot}: LightclientInitArgs) {
    this.config = config;
    this.logger = logger ?? getLcLoggerConsole();
    this.clock = new Clock(config, genesisData.genesisTime);
    this.genesisValidatorsRoot =
      typeof genesisData.genesisValidatorsRoot === "string"
        ? fromHexString(genesisData.genesisValidatorsRoot)
        : genesisData.genesisValidatorsRoot;

    this.beaconApiUrl = beaconApiUrl;
    this.api = getClient(config, {baseUrl: beaconApiUrl});

    const periodCurr = computeSyncPeriodAtSlot(snapshot.header.slot);
    const periodNext = periodCurr + 1;

    this.syncCommitteeByPeriod.set(periodCurr, {
      isFinalized: false,
      participation: 0,
      slot: periodCurr * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH,
      ...deserializeSyncCommittee(snapshot.currentSyncCommittee),
    });
    this.syncCommitteeByPeriod.set(periodNext, {
      isFinalized: false,
      participation: 0,
      slot: periodNext * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH,
      ...deserializeSyncCommittee(snapshot.nextSyncCommittee),
    });

    this.head = {
      participation: 0,
      header: snapshot.header,
      blockRoot: toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(snapshot.header)),
    };
  }

  static async initializeFromCheckpoint({
    config,
    logger,
    beaconApiUrl,
    genesisData,
    checkpoint,
  }: {
    config: IChainForkConfig;
    logger?: ILcLogger;
    beaconApiUrl: string;
    genesisData: GenesisData;
    checkpoint: phase0.Checkpoint;
  }): Promise<Lightclient> {
    const api = getClient(config, {baseUrl: beaconApiUrl});

    // Fetch snapshot with proof at the trusted block root
    const {data: snapshotWithProof} = await api.lightclient.getSnapshot(toHexString(checkpoint.root));
    const {header, currentSyncCommittee, nextSyncCommittee, syncCommitteesBranch} = snapshotWithProof;

    // verify the response matches the requested root
    const headerRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    if (!ssz.Root.equals(checkpoint.root, headerRoot)) {
      throw new Error("Snapshot header does not match trusted checkpoint");
    }

    // Verify the sync committees
    if (
      !isValidSyncCommitteesBranch(
        ssz.altair.SyncCommittee.hashTreeRoot(currentSyncCommittee),
        ssz.altair.SyncCommittee.hashTreeRoot(nextSyncCommittee),
        syncCommitteesBranch,
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

  getHead(): phase0.BeaconBlockHeader {
    return this.head.header;
  }

  async getHeadStateProof(paths: Path[]): Promise<TreeOffsetProof> {
    const stateId = toHexString(this.head.header.stateRoot);
    const res = await this.api.lightclient.getStateProof(stateId, paths);
    return res.data as TreeOffsetProof;
  }

  async sync(fromPeriod: SyncPeriod, toPeriod: SyncPeriod): Promise<void> {
    const periodRanges = chunkifyInclusiveRange(fromPeriod, toPeriod, MAX_PERIODS_PER_REQUEST);

    for (const [fromPeriodRng, toPeriodRng] of periodRanges) {
      this.logger.debug(`getCommitteeUpdates(${fromPeriodRng}, ${toPeriodRng})`);
      const {data: updates} = await this.api.lightclient.getCommitteeUpdates(fromPeriodRng, toPeriodRng);
      for (const update of updates) {
        this.processSyncCommitteeUpdate(update);
        this.logger.debug(`processed sync update for period ${computeSyncPeriodAtSlot(update.header.slot)}`);
        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private async runLoop(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const lastPeriod = computeSyncPeriodAtSlot(this.head.header.slot);
      const currentPeriod = computeSyncPeriodAtSlot(this.clock.currentSlot);

      if (lastPeriod !== currentPeriod) {
        this.status = {code: RunStatusCode.syncing};
        this.logger.debug("Syncing", {lastPeriod, currentPeriod});

        try {
          await this.sync(lastPeriod, currentPeriod);
          this.logger.debug("Synced", {currentPeriod});
        } catch (e) {
          this.logger.error("Error sync", {}, e as Error);

          // Retry in 1 second
          await new Promise((r) => setTimeout(r, ON_ERROR_RETRY_MS));
          continue;
        }
      }

      if (this.status.code !== RunStatusCode.started) {
        const controller = new AbortController();
        this.status = {code: RunStatusCode.started, controller};
        this.logger.debug("Started tracking the head");

        // Sync committee periods every epoch
        this.clock.start(controller.signal);
        this.clock.runEveryEpoch(this.onEveryEpoch);

        // Subscribe to head updates over SSE
        this.api.events.eventstream([routes.events.EventType.lightclientUpdate], controller.signal, this.onSSE);
      }

      return;

      // TODO: Consider merging onEveryEpoch() here
    }
  }

  private onEveryEpoch = async (epoch: Epoch): Promise<void> => {
    // Limit lookahead in case EPOCHS_PER_SYNC_COMMITTEE_PERIOD is configured to be very short
    const lookaheadEpochs = Math.min(LOOKAHEAD_EPOCHS_COMMITTEE_SYNC, EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
    const epochsIntoPeriod = epoch % EPOCHS_PER_SYNC_COMMITTEE_PERIOD;

    // Start fetching updates with some lookahead
    if (EPOCHS_PER_SYNC_COMMITTEE_PERIOD - epochsIntoPeriod <= lookaheadEpochs) {
      const period = computeSyncPeriodAtEpoch(epoch);
      await this.sync(period, period);
    }
  };

  private onSSE = (event: routes.events.BeaconEvent): void => {
    try {
      switch (event.type) {
        case routes.events.EventType.lightclientUpdate:
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
    const {header, syncAggregate} = headerUpdate;

    // Prevent registering updates for slots to far ahead
    if (header.slot > this.clock.slotWithFutureTolerance(MAX_CLOCK_DISPARITY_SEC)) {
      throw Error(`header.slot ${header.slot} is too far in the future, currentSlot: ${this.clock.currentSlot}`);
    }

    const period = computeSyncPeriodAtSlot(header.slot);
    const syncCommittee = this.syncCommitteeByPeriod.get(period);
    if (!syncCommittee) {
      // TODO: Attempt to fetch committee update for period if it's before the current clock period
      throw Error(`No syncCommittee for period ${period}`);
    }

    // TODO: Make this work with random testnets
    const forkVersion = this.config.getForkVersion(header.slot);

    assertValidSignedHeader(syncCommittee, syncAggregate, header, this.genesisValidatorsRoot, forkVersion);

    // Valid header, check if has enough bits.
    // Only accept headers that have at least half of the max participation seen in this period
    const maxParticipation = this.maxParticipationByPeriod.get(period) ?? 0;
    const safetyThreshold = Math.max(1, Math.floor(maxParticipation / SAFETY_THRESHOLD_FACTOR));

    const participation = sumBits(syncAggregate.syncCommitteeBits);
    if (participation < safetyThreshold) {
      // TODO: Not really an error, this can happen
      throw Error(`syncAggregate has participation ${participation} less than safetyThreshold ${safetyThreshold}`);
    }

    // Maybe register new max participation
    if (participation > maxParticipation) {
      this.maxParticipationByPeriod.set(period, participation);
      pruneSetToMax(this.maxParticipationByPeriod, MAX_STORED_SYNC_COMMITTEES);
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
      this.head = {header, participation, blockRoot: headerUpdate.blockRoot};

      this.logger.debug("Head updated", {
        prevHead: `${prevHead.header.slot} ${prevHead.blockRoot}`,
        newHead: `${header.slot} ${headerUpdate.blockRoot}`,
      });
      // Emit to consumers
      this.emitter.emit(LightclientEvent.head, header);
    } else {
      this.logger.debug("Received valid head update did not update head", {
        currentHead: `${this.head.header.slot} ${this.head.blockRoot}`,
        eventHead: `${header.slot} ${headerUpdate.blockRoot}`,
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
    // Prevent registering updates for slots to far ahead
    const isFinalized = !isEmptyHeader(update.finalityHeader);
    const updateSlot = isFinalized ? update.finalityHeader.slot : update.header.slot;
    if (updateSlot > this.clock.slotWithFutureTolerance(MAX_CLOCK_DISPARITY_SEC)) {
      throw Error(`updateSlot ${updateSlot} is too far in the future, currentSlot ${this.clock.currentSlot}`);
    }

    // Must not rollback periods
    const updatePeriod = computeSyncPeriodAtSlot(updateSlot);
    const minPeriod = Math.min(-Infinity, ...this.syncCommitteeByPeriod.keys());
    if (updatePeriod < minPeriod) {
      throw Error(`update must not rollback existing committee at period ${minPeriod}`);
    }

    const syncCommittee = this.syncCommitteeByPeriod.get(updatePeriod);
    if (!syncCommittee) {
      throw Error(`No SyncCommittee for period ${updatePeriod}`);
    }

    assertValidLightClientUpdate(syncCommittee, update, this.genesisValidatorsRoot, update.forkVersion);

    const nextPeriod = updatePeriod + 1;
    const existingNextSyncCommittee = this.syncCommitteeByPeriod.get(nextPeriod);
    const newNextSyncCommitteeStats: LightclientUpdateStats = {
      isFinalized,
      participation: sumBits(update.syncCommitteeBits),
      slot: updateSlot,
    };

    if (!existingNextSyncCommittee || isBetterUpdate(existingNextSyncCommittee, newNextSyncCommitteeStats)) {
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
