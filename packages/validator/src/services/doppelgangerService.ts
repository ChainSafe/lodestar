import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {computeEndSlotForEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {AbortController} from "@chainsafe/abort-controller";
import {LivenessResponseData} from "@chainsafe/lodestar-api/src/routes/validator";
import {PubkeyHex} from "../types";
import {IClock} from "../util";
import {Metrics} from "../metrics";
import {IndicesService} from "./indices";

// The number of epochs that must be checked before we assume that there are
// no other duplicate validators on the network
const DEFAULT_REMAINING_DETECTION_EPOCHS = 1;

type DoppelgangerState = {
  epochRegistered: Epoch;
  epochChecked: Epoch[];
  remainingEpochsToCheck: number;
};

export enum DoppelgangerStatus {
  VerifiedSafe = "VerifiedSafe",
  Unverified = "Unverified",
  Unknown = "Unknown",
}

export class DoppelgangerService {
  private readonly doppelgangerStateByIndex = new Map<ValidatorIndex, DoppelgangerState>();

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILogger,
    private readonly clock: IClock,
    private readonly api: Api,
    private readonly genesisTime: number,
    private readonly indicesService: IndicesService,
    private readonly validatorController: AbortController,
    private readonly metrics: Metrics | null
  ) {
    this.metrics = metrics;
    this.clock.runEveryEpoch(this.pollLiveness);
  }

  isDoppelgangerSafe(pubKeyHex: PubkeyHex): boolean {
    switch (this.getStatus(pubKeyHex)) {
      case DoppelgangerStatus.VerifiedSafe:
        return true;
      case DoppelgangerStatus.Unknown:
      case DoppelgangerStatus.Unverified:
        return false;
    }
  }

  getStatus(pubkeyHex: PubkeyHex): DoppelgangerStatus {
    const validatorIndex = this.indicesService.getValidatorIndex(pubkeyHex);

    if (validatorIndex != null) {
      const doppelgangerState = this.doppelgangerStateByIndex.get(validatorIndex);
      if (doppelgangerState?.remainingEpochsToCheck == 0) {
        return DoppelgangerStatus.VerifiedSafe;
      } else {
        return DoppelgangerStatus.Unverified;
      }
    } else {
      this.logger.error(`Validator index not know for public key ${pubkeyHex}`);
      return DoppelgangerStatus.Unknown;
    }
  }

  private pollLiveness = async (currentEpoch: Epoch): Promise<void> => {
    if (currentEpoch < 0) {
      return;
    }

    const endSlotOfEpoch = computeEndSlotForEpoch(currentEpoch);
    // Run the doppelganger protection check 75% through the last slot of this epoch. This
    // *should* mean that the BN has seen the blocks and attestations for the epoch
    await sleep(this.clock.msToSlot(endSlotOfEpoch + 3 / 4));
    const timer = this.metrics?.doppelganger.checkDuration.startTimer();
    const indices = await this.getIndicesToCheck(currentEpoch);
    if (indices.length !== 0) {
      const previousEpoch = currentEpoch - 1;
      // in the current epoch also request for liveness check for past epoch in case a validator index was live
      // in the remaining 25% of the last slot of the previous epoch
      const previous =
        previousEpoch >= 0
          ? (
              await this.api.validator.getLiveness(indices, previousEpoch).catch((e) => {
                this.logger.error(`Error getting liveness data for previous epoch ${previousEpoch}`, {}, e as Error);
                return {data: []};
              })
            ).data
          : [];

      const current: LivenessResponseData[] = (
        await this.api.validator.getLiveness(indices, currentEpoch).catch((e) => {
          this.logger.error("Error getting liveness data for current epoch `${currentEpoch}`", {}, e as Error);
          return Promise.resolve({data: []});
        })
      ).data;

      this.detectDoppelganger([...previous, ...current], currentEpoch);
    }
    timer?.();
  };

  private detectDoppelganger(livenessData: LivenessResponseData[], currentEpoch: Epoch): void {
    const violators = [];

    for (const [validatorIndex, doppelgangerState] of Array.from(this.doppelgangerStateByIndex.entries())) {
      const indicesToCheck = livenessData.filter((liveness) => {
        return liveness.index === validatorIndex;
      });

      for (const validatorIndexToBeChecked of indicesToCheck) {
        // Get the last epoch checked. Do not perform another check if the epoch
        // in the liveness data is not > lastEpochChecked. This is to avoid
        // the scenario where a user reboots their VC inside a single epoch, and
        // we detect the activity of that previous process as doppelganger
        // activity, even when it's not running anymore
        const lastEpochChecked = Math.max(...doppelgangerState.epochChecked);
        if (
          doppelgangerState.remainingEpochsToCheck !== 0 &&
          validatorIndexToBeChecked?.isLive &&
          validatorIndexToBeChecked?.epoch > lastEpochChecked
        ) {
          violators.push(validatorIndexToBeChecked.index);
        } else {
          if (doppelgangerState.remainingEpochsToCheck !== 0) {
            doppelgangerState.remainingEpochsToCheck = doppelgangerState.remainingEpochsToCheck - 1;
            doppelgangerState.epochChecked.push(currentEpoch);
          }
        }
      }
    }

    if (violators.length !== 0) {
      this.logger.error(`Doppelganger detected for validator indices: ${violators}. Shutting down.`);
      this.validatorController.abort();
    }
  }

  private async getIndicesToCheck(currentEpoch: Epoch): Promise<ValidatorIndex[]> {
    // Get all protected indices by doppelganger
    const protectedIndices: ValidatorIndex[] = [];

    for (const [index, state] of this.doppelgangerStateByIndex.entries()) {
      if (state.remainingEpochsToCheck != 0) {
        protectedIndices.push(index);
      }
    }

    try {
      // then get new indices if any not already protected by doppelganger
      const polledIndices = await this.pollIndices();
      const newIndices = polledIndices.filter((polledindex) => !protectedIndices.includes(polledindex));
      // register new indices to be protected by doppelganger
      this.doRegister(newIndices, currentEpoch);
      return [...protectedIndices, ...newIndices];
    } catch (e) {
      this.logger.error("Error polling validator indices", {}, e as Error);
      return protectedIndices;
    }
  }

  private async pollIndices(): Promise<ValidatorIndex[]> {
    const localIndices = this.indicesService.getAllLocalIndices();
    const polledIndices = await this.indicesService.pollValidatorIndices();
    return [...localIndices, ...polledIndices];
  }

  private doRegister(validatorIndices: ValidatorIndex[], epoch: Epoch): void {
    if (validatorIndices.length > 0) {
      for (const index of validatorIndices) {
        if (!this.doppelgangerStateByIndex.has(index)) {
          this.logger.info(`Registered index: ${index} for doppelganger protection at epoch ${epoch}`);
          this.doppelgangerStateByIndex.set(index, {
            epochRegistered: epoch,
            epochChecked: [],
            remainingEpochsToCheck: DEFAULT_REMAINING_DETECTION_EPOCHS,
          });
        }
      }
    }
  }
}
