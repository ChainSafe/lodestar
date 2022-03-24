import {IClock} from "../util";
import {Epoch, ValidatorIndex} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";
import {IndicesService} from "./indices";
import {ILogger, sleep} from "@chainsafe/lodestar-utils";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {LivenessResponseData} from "@chainsafe/lodestar-api/src/routes/lodestar";
import {computeEndSlotForEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {PubkeyHex} from "../types";
import {AbortController} from "@chainsafe/abort-controller";

type DoppelgangerState = {
  nextCheckEpoch: Epoch;
  remainingEpochsToCheck: number;
};

export class DoppelgangerService {
  private readonly doppelgangerStateByIndex = new Map<PubkeyHex, DoppelgangerState>();
  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILogger,
    private readonly clock: IClock,
    private readonly api: Api,
    private readonly genesisTime: number,
    private readonly indicesService: IndicesService,
    private readonly validatorController: AbortController
  ) {
    this.clock.runEveryEpoch(this.pollLiveness);
  }

  register(pubKeys: PubkeyHex[]): void {
    for (const pubKey of pubKeys) {
      this.doppelgangerStateByIndex.set(pubKey, {
        nextCheckEpoch: 0,
        remainingEpochsToCheck: 2,
      });
    }
  }

  private pollLiveness = async (currentEpoch: Epoch): Promise<void> => {
    if (currentEpoch < 0) {
      return;
    }

    const endSlotOfEpoch = computeEndSlotForEpoch(currentEpoch);
    // Run the doppelganger protection check 75% through each epoch. This
    // *should* mean that the BN has seen the blocks and attestations for the epoch
    await sleep(this.clock.msToSlotFraction(endSlotOfEpoch, 3 / 4));
    const indices = await this.getIndices();
    if (indices.length !== 0) {
      try {
        const previous: LivenessResponseData[] = (await this.api.lodestar.getLiveness(indices, currentEpoch - 1)).data;
        const current: LivenessResponseData[] = (await this.api.lodestar.getLiveness(indices, currentEpoch)).data;

        this.detect({previous, current});
      } catch (e) {
        this.logger.error("Error getting liveness data", {}, e as Error);
      }
    }
    return Promise.resolve();
  };

  private detect(livenessData: {previous: LivenessResponseData[]; current: LivenessResponseData[]}): void {
    const liveness = [...livenessData.previous, ...livenessData.current];
    for (const [pubKey, doppelgangerState] of Array.from(this.doppelgangerStateByIndex.entries())) {
      const livenessData = liveness.find((response) => {
        return response.index === this.indicesService.pubkey2index.get(pubKey);
      });

      if (doppelgangerState.remainingEpochsToCheck !== 0 && livenessData?.isLive) {
        this.logger.error("Doppelganger protection detected for validator index: {}", livenessData.index);
        this.validatorController.abort();
      } else {
        doppelgangerState.remainingEpochsToCheck = doppelgangerState.remainingEpochsToCheck - 1;
      }
    }
  }

  private async getIndices(): Promise<ValidatorIndex[]> {
    // Run to get for all known local indices
    const localIndices = this.indicesService.getAllLocalIndices();
    try {
      const newIndices = await this.indicesService.pollValidatorIndices();
      return [...localIndices, ...newIndices];
    } catch (e) {
      this.logger.error("Error polling validator indices", {}, e as Error);
      return localIndices;
    }
  }
}
