import {Epoch, ValidatorIndex} from "@lodestar/types";
import {ApiClient, routes} from "@lodestar/api";
import {Logger, fromHex, sleep, truncBytes} from "@lodestar/utils";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ISlashingProtection} from "../slashingProtection/index.js";
import {ProcessShutdownCallback, PubkeyHex} from "../types.js";
import {IClock} from "../util/index.js";
import {Metrics} from "../metrics.js";
import {IndicesService} from "./indices.js";

// The number of epochs that must be checked before we assume that there are
// no other duplicate validators on the network
const DEFAULT_REMAINING_DETECTION_EPOCHS = 1;
const REMAINING_EPOCHS_IF_DOPPELGANGER = Infinity;
const REMAINING_EPOCHS_IF_SKIPPED = 0;

/** Liveness responses for a given epoch */
type EpochLivenessData = {
  epoch: Epoch;
  responses: routes.validator.LivenessResponseData[];
};

export type DoppelgangerState = {
  nextEpochToCheck: Epoch;
  remainingEpochs: Epoch;
};

export enum DoppelgangerStatus {
  /** This pubkey is known to the doppelganger service and has been verified safe */
  VerifiedSafe = "VerifiedSafe",
  /** This pubkey is known to the doppelganger service but has not been verified safe */
  Unverified = "Unverified",
  /** This pubkey is unknown to the doppelganger service */
  Unknown = "Unknown",
  /** This pubkey has been detected to be active on the network */
  DoppelgangerDetected = "DoppelgangerDetected",
}

export class DoppelgangerService {
  private readonly doppelgangerStateByPubkey = new Map<PubkeyHex, DoppelgangerState>();

  constructor(
    private readonly logger: Logger,
    private readonly clock: IClock,
    private readonly api: ApiClient,
    private readonly indicesService: IndicesService,
    private readonly slashingProtection: ISlashingProtection,
    private readonly processShutdownCallback: ProcessShutdownCallback,
    private readonly metrics: Metrics | null
  ) {
    this.clock.runEveryEpoch(this.pollLiveness);

    if (metrics) {
      metrics.doppelganger.statusCount.addCollect(() => this.onScrapeMetrics(metrics));
    }

    this.logger.info("Doppelganger protection enabled", {detectionEpochs: DEFAULT_REMAINING_DETECTION_EPOCHS});
  }

  async registerValidator(pubkeyHex: PubkeyHex): Promise<void> {
    const {currentEpoch} = this.clock;
    // Disable doppelganger protection when the validator was initialized before genesis.
    // There's no activity before genesis, so doppelganger is pointless.
    let remainingEpochs = currentEpoch <= 0 ? REMAINING_EPOCHS_IF_SKIPPED : DEFAULT_REMAINING_DETECTION_EPOCHS;
    const nextEpochToCheck = currentEpoch + 1;

    // Log here to alert that validation won't be active until remainingEpochs == 0
    if (remainingEpochs > 0) {
      const previousEpoch = currentEpoch - 1;
      const attestedInPreviousEpoch = await this.slashingProtection.hasAttestedInEpoch(
        fromHex(pubkeyHex),
        previousEpoch
      );

      if (attestedInPreviousEpoch) {
        // It is safe to skip doppelganger detection
        // https://github.com/ChainSafe/lodestar/issues/5856
        remainingEpochs = REMAINING_EPOCHS_IF_SKIPPED;
        this.logger.info("Doppelganger detection skipped for validator because restart was detected", {
          pubkey: truncBytes(pubkeyHex),
          previousEpoch,
        });
      } else {
        this.logger.info("Registered validator for doppelganger detection", {
          pubkey: truncBytes(pubkeyHex),
          remainingEpochs,
          nextEpochToCheck,
        });
      }
    } else {
      this.logger.info("Doppelganger detection skipped for validator initialized before genesis", {
        pubkey: truncBytes(pubkeyHex),
        currentEpoch,
      });
    }

    this.doppelgangerStateByPubkey.set(pubkeyHex, {
      nextEpochToCheck,
      remainingEpochs,
    });
  }

  unregisterValidator(pubkeyHex: PubkeyHex): void {
    this.doppelgangerStateByPubkey.delete(pubkeyHex);
  }

  getStatus(pubKeyHex: PubkeyHex): DoppelgangerStatus {
    return getStatus(this.doppelgangerStateByPubkey.get(pubKeyHex));
  }

  isDoppelgangerSafe(pubKeyHex: PubkeyHex): boolean {
    return getStatus(this.doppelgangerStateByPubkey.get(pubKeyHex)) === DoppelgangerStatus.VerifiedSafe;
  }

  private pollLiveness = async (currentEpoch: Epoch, signal: AbortSignal): Promise<void> => {
    if (currentEpoch < 0) {
      return;
    }

    const endSlotOfCurrentEpoch = computeStartSlotAtEpoch(currentEpoch + 1) - 1;
    // Run the doppelganger protection check 75% through the last slot of this epoch. This
    // *should* mean that the BN has seen the blocks and attestations for the epoch
    await sleep(this.clock.msToSlot(endSlotOfCurrentEpoch + 3 / 4), signal);

    // Collect indices that still need doppelganger checks
    const pubkeysToCheckWithoutIndex: PubkeyHex[] = [];
    // Collect as Map for detectDoppelganger() which needs to map back index -> pubkey
    const indicesToCheckMap = new Map<ValidatorIndex, PubkeyHex>();

    for (const [pubkeyHex, state] of this.doppelgangerStateByPubkey.entries()) {
      if (state.remainingEpochs > 0 && state.nextEpochToCheck <= currentEpoch) {
        const index = this.indicesService.pubkey2index.get(pubkeyHex);
        if (index !== undefined) {
          indicesToCheckMap.set(index, pubkeyHex);
        } else {
          pubkeysToCheckWithoutIndex.push(pubkeyHex);
        }
      }
    }

    // Attempt to collect missing indexes
    const newIndices = await this.indicesService.pollValidatorIndices(pubkeysToCheckWithoutIndex);
    for (const index of newIndices) {
      const pubkey = this.indicesService.index2pubkey.get(index);
      if (pubkey) {
        indicesToCheckMap.set(index, pubkey);
      }
    }

    if (indicesToCheckMap.size === 0) {
      return;
    }

    this.logger.info("Doppelganger liveness check", {currentEpoch, indicesCount: indicesToCheckMap.size});

    // in the current epoch also request for liveness check for past epoch in case a validator index was live
    // in the remaining 25% of the last slot of the previous epoch
    const indicesToCheck = Array.from(indicesToCheckMap.keys());
    const [previous, current] = await Promise.all([
      this.getLiveness(currentEpoch - 1, indicesToCheck),
      this.getLiveness(currentEpoch, indicesToCheck),
    ]);

    this.detectDoppelganger(currentEpoch, previous, current, indicesToCheckMap);
  };

  private async getLiveness(epoch: Epoch, indicesToCheck: ValidatorIndex[]): Promise<EpochLivenessData> {
    if (epoch < 0) {
      return {epoch, responses: []};
    }

    const res = await this.api.validator.getLiveness({epoch, indices: indicesToCheck});
    if (!res.ok) {
      this.logger.error(`Error getting liveness data for epoch ${epoch}`, {}, res.error() as Error);
      return {epoch, responses: []};
    }
    return {epoch, responses: res.value()};
  }

  private detectDoppelganger(
    currentEpoch: Epoch,
    previousEpochLiveness: EpochLivenessData,
    currentEpochLiveness: EpochLivenessData,
    indicesToCheckMap: Map<ValidatorIndex, PubkeyHex>
  ): void {
    const previousEpoch = currentEpoch - 1;
    const violators: ValidatorIndex[] = [];

    // Perform a loop through the current and previous epoch responses and detect any violators.
    //
    // A following loop will update the states of each validator, depending on whether or not
    // any violators were detected here.

    for (const {epoch, responses} of [previousEpochLiveness, currentEpochLiveness]) {
      for (const response of responses) {
        if (!response.isLive) {
          continue;
        }

        const state = this.doppelgangerStateByPubkey.get(indicesToCheckMap.get(response.index) ?? "");
        if (!state) {
          this.logger.error(`Inconsistent livenessResponseData unknown index ${response.index}`);
          continue;
        }

        if (state.nextEpochToCheck <= epoch) {
          // Doppelganger detected
          violators.push(response.index);
        }
      }
    }

    if (violators.length > 0) {
      // If a single doppelganger is detected, enable doppelganger checks on all validators forever
      for (const state of this.doppelgangerStateByPubkey.values()) {
        state.remainingEpochs = REMAINING_EPOCHS_IF_DOPPELGANGER;
      }

      this.logger.error(
        `Doppelganger(s) detected
        A doppelganger occurs when two different validator clients run the same public key.
        This validator client detected another instance of a local validator on the network
        and is shutting down to prevent potential slashable offenses. Ensure that you are not
        running a duplicate or overlapping validator client`,
        violators
      );

      // Request process to shutdown
      this.processShutdownCallback(Error("Doppelganger(s) detected"));
    }

    // If not there are no validators
    else {
      // Iterate through all the previous epoch responses, updating `self.doppelganger_states`.
      //
      // Do not bother iterating through the current epoch responses since they've already been
      // checked for violators and they don't result in updating the state.
      for (const response of previousEpochLiveness.responses) {
        const state = this.doppelgangerStateByPubkey.get(indicesToCheckMap.get(response.index) ?? "");
        if (!state) {
          this.logger.error(`Inconsistent livenessResponseData unknown index ${response.index}`);
          continue;
        }

        if (!response.isLive && state.nextEpochToCheck <= previousEpoch) {
          state.remainingEpochs--;
          state.nextEpochToCheck = currentEpoch;
          this.metrics?.doppelganger.epochsChecked.inc(1);

          const {remainingEpochs, nextEpochToCheck} = state;
          if (remainingEpochs <= 0) {
            this.logger.info("Doppelganger detection complete", {index: response.index, epoch: currentEpoch});
          } else {
            this.logger.info("Found no doppelganger", {index: response.index, remainingEpochs, nextEpochToCheck});
          }
        }
      }
    }
  }

  private onScrapeMetrics(metrics: Metrics): void {
    const countByStatus = new Map<DoppelgangerStatus, number>();
    for (const state of this.doppelgangerStateByPubkey.values()) {
      const status = getStatus(state);
      countByStatus.set(status, (countByStatus.get(status) ?? 0) + 1);
    }

    // Loop over DoppelgangerStatus not countByStatus to zero status without counts
    for (const status of Object.values(DoppelgangerStatus)) {
      metrics.doppelganger.statusCount.set({status}, countByStatus.get(status) ?? 0);
    }
  }
}

function getStatus(state: DoppelgangerState | undefined): DoppelgangerStatus {
  if (!state) {
    return DoppelgangerStatus.Unknown;
  }
  if (state.remainingEpochs <= 0) {
    return DoppelgangerStatus.VerifiedSafe;
  }
  if (state.remainingEpochs === REMAINING_EPOCHS_IF_DOPPELGANGER) {
    return DoppelgangerStatus.DoppelgangerDetected;
  }
  return DoppelgangerStatus.Unverified;
}
