import {IClock} from "../util";
import {BLSPubkey, Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";
import {IndicesService} from "./indices";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {LivenessResponseData} from "@chainsafe/lodestar-api/src/routes/lodestar";
import {computeEndSlotForEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {AbortController} from "@chainsafe/abort-controller";
import {toHexString} from "@chainsafe/ssz";
import {PubkeyHex} from "../types";

export const DEFAULT_REMAINING_EPOCH_CHECK = 2;

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
    private readonly doppelgangerEpochsToCheck: number
  ) {
    this.clock.runEveryEpoch(this.pollLiveness);
  }

  isDoppelgangerSafe(pubKey: PubkeyHex | BLSPubkey): boolean {
    switch (this.getStatus(pubKey)) {
      case DoppelgangerStatus.VerifiedSafe:
        return true;
      case DoppelgangerStatus.Unknown:
      case DoppelgangerStatus.Unverified:
        return false;
    }
  }

  private getStatus(pubKey: PubkeyHex | BLSPubkey): DoppelgangerStatus {
    const pubkeyHex = typeof pubKey === "string" ? pubKey : toHexString(pubKey);
    const validatorIndex = this.indicesService.getValidatorIndex(pubkeyHex);

    if (validatorIndex != null) {
      const doppelgangerState = this.doppelgangerStateByIndex.get(validatorIndex);
      if (doppelgangerState?.remainingEpochsToCheck == 0) {
        return DoppelgangerStatus.VerifiedSafe;
      } else {
        return DoppelgangerStatus.Unverified;
      }
    } else {
      this.logger.error(`Validator Index not know for public key ${pubKey}`);
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
    await sleep(this.clock.msToSlotFraction(endSlotOfEpoch, 3 / 4));
    const indices = await this.getIndicesToCheck(currentEpoch);
    if (indices.length !== 0) {
      const previousEpoch = currentEpoch - 1;
      // in the current epoch also request for liveness check for past epoch in case a validator index was live
      // in the remaining 25% of the last slot of the previous epoch
      const previous =
        previousEpoch >= 0
          ? (
              await this.api.lodestar.getLiveness(indices, previousEpoch).catch((e) => {
                this.logger.error(`Error getting liveness data for previous epoch ${previousEpoch}`, {}, e as Error);
                return Promise.resolve({data: []});
              })
            ).data
          : [];

      const current: LivenessResponseData[] = (
        await this.api.lodestar.getLiveness(indices, currentEpoch).catch((e) => {
          this.logger.error("Error getting liveness data for current epoch `${currentEpoch}`", {}, e as Error);
          return Promise.resolve({data: []});
        })
      ).data;

      this.detectDoppelganger([...previous, ...current], currentEpoch);
    }
  };

  private detectDoppelganger(livenessData: LivenessResponseData[], currentEpoch: Epoch): void {
    const violators = [];

    for (const [validatorIndex, doppelgangerState] of Array.from(this.doppelgangerStateByIndex.entries())) {
      const validatorIndexToBeChecked = livenessData.find((liveness) => {
        return liveness.index === validatorIndex;
      });

      if (doppelgangerState.remainingEpochsToCheck !== 0 && validatorIndexToBeChecked?.isLive) {
        violators.push(validatorIndexToBeChecked.index);
      } else {
        if (doppelgangerState.remainingEpochsToCheck !== 0) {
          doppelgangerState.remainingEpochsToCheck = doppelgangerState.remainingEpochsToCheck - 1;
          doppelgangerState.epochChecked.push(currentEpoch);
        }
      }
    }

    if (violators.length !== 0) {
      this.logger.error(`Doppelganger detected for validator indices: ${violators}`);
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
            remainingEpochsToCheck:
              this.doppelgangerEpochsToCheck != null ? this.doppelgangerEpochsToCheck : DEFAULT_REMAINING_EPOCH_CHECK,
          });
        }
      }
    }
  }
}
