import mitt from "mitt";
import {init as initBls} from "@chainsafe/bls/switchable";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD} from "@lodestar/params";
import {phase0, RootHex, Slot, SyncPeriod, allForks} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {isErrorAborted, sleep} from "@lodestar/utils";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {getCurrentSlot, slotWithFutureTolerance, timeUntilNextEpoch} from "./utils/clock.js";
import {isNode} from "./utils/utils.js";
import {chunkifyInclusiveRange} from "./utils/chunkify.js";
import {LightclientEmitter, LightclientEvent} from "./events.js";
import {getLcLoggerConsole, ILcLogger} from "./utils/logger.js";
import {computeSyncPeriodAtEpoch, computeSyncPeriodAtSlot, computeEpochAtSlot} from "./utils/clock.js";
import {LightclientSpec} from "./spec/index.js";
import {validateLightClientBootstrap} from "./spec/validateLightClientBootstrap.js";
import {ProcessUpdateOpts} from "./spec/processLightClientUpdate.js";
import {LightClientTransport} from "./transport/interface.js";

// Re-export types
export {LightclientEvent} from "./events.js";
export {SyncCommitteeFast} from "./types.js";

export type GenesisData = {
  genesisTime: number;
  genesisValidatorsRoot: RootHex | Uint8Array;
};

export type LightclientOpts = ProcessUpdateOpts;

export type LightclientInitArgs = {
  config: ChainForkConfig;
  logger?: ILcLogger;
  opts?: LightclientOpts;
  genesisData: GenesisData;
  transport: LightClientTransport;
  bootstrap: allForks.LightClientBootstrap;
};

/** Provides some protection against a server client sending header updates too far away in the future */
const MAX_CLOCK_DISPARITY_SEC = 10;
/** Prevent responses that are too big and get truncated. No specific reasoning for 32 */
const MAX_PERIODS_PER_REQUEST = 32;
/** For mainnet preset 8 epochs, for minimal preset `EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2` */
const LOOKAHEAD_EPOCHS_COMMITTEE_SYNC = Math.min(8, Math.ceil(EPOCHS_PER_SYNC_COMMITTEE_PERIOD / 2));
/** Prevent infinite loops caused by sync errors */
const ON_ERROR_RETRY_MS = 1000;

// TODO: Customize with option
const ALLOW_FORCED_UPDATES = true;

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
 *   - For new lightclient instances, it can be queries from a trustless node at GET lightclient/bootstrap
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
 * - During most of period 0, current_sync_committee known, next_sync_committee unknown
 * - At the end of period 0, get a sync committee update, and populate period 1's committee
 *
 * syncCommittees: Map<SyncPeriod, SyncCommittee>, limited to max of 2 items
 */
export class Lightclient {
  readonly emitter: LightclientEmitter = mitt();
  readonly config: BeaconConfig;
  readonly logger: ILcLogger;
  readonly genesisValidatorsRoot: Uint8Array;
  readonly genesisTime: number;
  private readonly transport: LightClientTransport;

  private readonly lightclientSpec: LightclientSpec;

  private status: RunStatus = {code: RunStatusCode.stopped};

  constructor({config, logger, genesisData, bootstrap, transport}: LightclientInitArgs) {
    this.genesisTime = genesisData.genesisTime;
    this.genesisValidatorsRoot =
      typeof genesisData.genesisValidatorsRoot === "string"
        ? fromHexString(genesisData.genesisValidatorsRoot)
        : genesisData.genesisValidatorsRoot;

    this.config = createBeaconConfig(config, this.genesisValidatorsRoot);
    this.logger = logger ?? getLcLoggerConsole();
    this.transport = transport;

    this.lightclientSpec = new LightclientSpec(
      this.config,
      {
        allowForcedUpdates: ALLOW_FORCED_UPDATES,
        onSetFinalizedHeader: (header) => {
          this.emitter.emit(LightclientEvent.lightClientFinalityUpdate, header);
          this.logger.debug("Updated state.finalizedHeader", {slot: header.beacon.slot});
        },
        onSetOptimisticHeader: (header) => {
          this.emitter.emit(LightclientEvent.lightClientOptimisticUpdate, header);
          this.logger.debug("Updated state.optimisticHeader", {slot: header.beacon.slot});
        },
      },
      bootstrap
    );
  }

  // Embed lightweight clock. The epoch cycles are handled with `this.runLoop()`
  get currentSlot(): number {
    return getCurrentSlot(this.config, this.genesisTime);
  }

  static async initializeFromCheckpointRoot(
    args: Omit<LightclientInitArgs, "bootstrap"> & {
      checkpointRoot: phase0.Checkpoint["root"];
    }
  ): Promise<Lightclient> {
    const {transport, checkpointRoot} = args;

    // Initialize the BLS implementation. This may requires initializing the WebAssembly instance
    // so why it's an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    // Fetch bootstrap state with proof at the trusted block root
    const {data: bootstrap} = await transport.getBootstrap(toHexString(checkpointRoot));

    validateLightClientBootstrap(checkpointRoot, bootstrap);

    return new Lightclient({...args, bootstrap});
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

  getHead(): allForks.LightClientHeader {
    return this.lightclientSpec.store.optimisticHeader;
  }

  async sync(fromPeriod: SyncPeriod, toPeriod: SyncPeriod): Promise<void> {
    // Initialize the BLS implementation. This may requires initializing the WebAssembly instance
    // so why it's a an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    const periodRanges = chunkifyInclusiveRange(fromPeriod, toPeriod, MAX_PERIODS_PER_REQUEST);

    for (const [fromPeriodRng, toPeriodRng] of periodRanges) {
      const count = toPeriodRng + 1 - fromPeriodRng;
      const updates = await this.transport.getUpdates(fromPeriodRng, count);
      for (const update of updates) {
        this.processSyncCommitteeUpdate(update.data);
        this.logger.debug("processed sync update", {slot: update.data.attestedHeader.beacon.slot});

        // Yield to the macro queue, verifying updates is somewhat expensive and we want responsiveness
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  private async runLoop(): Promise<void> {
    // Initialize the BLS implementation. This may requires initializing the WebAssembly instance
    // so why it's a an async process. This should be initialized once before any bls operations.
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await initBls(isNode ? "blst-native" : "herumi");

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentPeriod = computeSyncPeriodAtSlot(this.currentSlot);
      // Check if we have a sync committee for the current clock period
      if (!this.lightclientSpec.store.syncCommittees.has(currentPeriod)) {
        // Stop head tracking
        if (this.status.code === RunStatusCode.started) {
          this.status.controller.abort();
        }

        // Go into sync mode
        this.status = {code: RunStatusCode.syncing};
        const headPeriod = computeSyncPeriodAtSlot(this.getHead().beacon.slot);
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
          const update = await this.transport.getOptimisticUpdate();
          this.processOptimisticUpdate(update.data);
        } catch (e) {
          this.logger.error("Error fetching getLatestHeadUpdate", {currentPeriod}, e as Error);
        }
      }

      // After successfully syncing, track head if not already
      if (this.status.code !== RunStatusCode.started) {
        const controller = new AbortController();
        this.status = {code: RunStatusCode.started, controller};
        this.logger.debug("Started tracking the head");

        this.transport.onOptimisticUpdate(this.processOptimisticUpdate.bind(this));
        this.transport.onFinalityUpdate(this.processFinalizedUpdate.bind(this));
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

  /**
   * Processes new optimistic header updates in only known synced sync periods.
   * This headerUpdate may update the head if there's enough participation.
   */
  private processOptimisticUpdate(optimisticUpdate: allForks.LightClientOptimisticUpdate): void {
    this.lightclientSpec.onOptimisticUpdate(this.currentSlotWithTolerance(), optimisticUpdate);
  }

  /**
   * Processes new header updates in only known synced sync periods.
   * This headerUpdate may update the head if there's enough participation.
   */
  private processFinalizedUpdate(finalizedUpdate: allForks.LightClientFinalityUpdate): void {
    this.lightclientSpec.onFinalityUpdate(this.currentSlotWithTolerance(), finalizedUpdate);
  }

  private processSyncCommitteeUpdate(update: allForks.LightClientUpdate): void {
    this.lightclientSpec.onUpdate(this.currentSlotWithTolerance(), update);
  }

  private currentSlotWithTolerance(): Slot {
    return slotWithFutureTolerance(this.config, this.genesisTime, MAX_CLOCK_DISPARITY_SEC);
  }
}
