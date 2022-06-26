import {Epoch} from "@chainsafe/lodestar-types";
import {Api, routes} from "@chainsafe/lodestar-api";

import {IClock, ILoggerVc} from "../util/index.js";
import {ValidatorStore} from "./validatorStore.js";

/**
 * This service is responsible for updating the BNs and/or Mev relays with
 * the corresponding feeRecipient suggestion. This should ideally run per epoch
 * but can be run per slot. Lighthouse also uses this to trigger any block
 */
export function pollPrepareBeaconProposer(
  logger: ILoggerVc,
  api: Api,
  clock: IClock,
  validatorStore: ValidatorStore
): void {
  clock.runEveryEpoch(async function prepareBeaconProposer(epoch: Epoch): Promise<void> {
    // prepareBeaconProposer is not as time sensitive as attesting.
    // Poll indices first, then call api.validator.prepareBeaconProposer once
    await validatorStore.pollValidatorIndices().catch((e: Error) => {
      logger.error("Error on pollValidatorIndices for prepareBeaconProposer", {epoch}, e);
    });

    const proposerData = validatorStore.getAllLocalIndices().map(
      (index): routes.validator.ProposerPreparationData => ({
        validatorIndex: String(index as number),
        feeRecipient: validatorStore.getFeeRecipientByIndex(index),
      })
    );

    await api.validator.prepareBeaconProposer(proposerData).catch((e: Error) => {
      logger.error("Error on prepareBeaconProposer", {epoch}, e);
    });
  });
}
