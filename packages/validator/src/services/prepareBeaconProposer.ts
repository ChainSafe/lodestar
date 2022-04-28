import {ValidatorIndex, ExecutionAddress, Epoch} from "@chainsafe/lodestar-types";
import {Api} from "@chainsafe/lodestar-api";

import {ValidatorStore} from "./validatorStore";
import {IndicesService} from "./indices";
import {IClock, ILoggerVc} from "../util";
import {Metrics} from "../metrics";

type ProposerPreparationData = {
  validatorIndex: ValidatorIndex;
  feeRecipient: ExecutionAddress;
};

/**
 * This service is responsible for updating the BNs and/or Mev relays with
 * the corresponding feeRecipient suggestion. This should ideally run per epoch
 * but can be run per slot. Lighthouse also uses this to trigger any block
 */
export class PrepareBeaconProposerService {
  constructor(
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly defaultSuggestedFeeRecipient: ExecutionAddress,
    private readonly indicesService: IndicesService,
    private readonly metrics: Metrics | null
  ) {
    clock.runEverySlot(this.prepareBeaconProposer);
  }

  private prepareBeaconProposer = async (epoch: Epoch): Promise<void> => {
    await Promise.all([
      // Run prepareBeaconProposer immediately for all known local indices
      this.api.validator
        .prepareBeaconProposer(this.getProposerData(this.indicesService.getAllLocalIndices()))
        .catch((e: Error) => {
          this.logger.error("Error on prepareBeaconProposer", {epoch}, e);
        }),

      // At the same time fetch any remaining unknown validator indices, then poll duties for those newIndices only
      this.indicesService
        .pollValidatorIndices()
        .then((newIndices) => this.api.validator.prepareBeaconProposer(this.getProposerData(newIndices)))
        .catch((e: Error) => {
          this.logger.error("Error on poll indices and prepareBeaconProposer", {epoch}, e);
        }),
    ]);
  };

  private getProposerData(indices: number[]): ProposerPreparationData[] {
    return indices.map((validatorIndex) => ({validatorIndex, feeRecipient: this.defaultSuggestedFeeRecipient}));
  }
}
