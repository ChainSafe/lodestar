import {ServerApi, routes} from "@lodestar/api";
import {getValidatorStatus} from "../../beacon/state/utils.js";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildRegisterValidator(
  {chain, logger}: ApiModules,
  _dep: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["registerValidator"] {
  return async function registerValidator(registrations) {
    if (!chain.executionBuilder) {
      throw Error("Execution builder not enabled");
    }

    // should only send active or pending validator to builder
    // Spec: https://ethereum.github.io/builder-specs/#/Builder/registerValidator
    const headState = chain.getHeadState();
    const currentEpoch = chain.clock.currentEpoch;

    const filteredRegistrations = registrations.filter((registration) => {
      const {pubkey} = registration.message;
      const validatorIndex = headState.epochCtx.pubkey2index.get(pubkey);
      if (validatorIndex === undefined) return false;

      const validator = headState.validators.getReadonly(validatorIndex);
      const status = getValidatorStatus(validator, currentEpoch);
      return (
        status === "active" ||
        status === "active_exiting" ||
        status === "active_ongoing" ||
        status === "active_slashed" ||
        status === "pending_initialized" ||
        status === "pending_queued"
      );
    });

    await chain.executionBuilder.registerValidator(filteredRegistrations);

    logger.debug("Forwarded validator registrations to connected builder", {
      epoch: currentEpoch,
      count: filteredRegistrations.length,
    });
  };
}
