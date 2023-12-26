import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildPrepareBeaconProposer(
  {chain}: ApiModules,
  _deps: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["prepareBeaconProposer"] {
  return async function prepareBeaconProposer(proposers) {
    await chain.updateBeaconProposerData(chain.clock.currentEpoch, proposers);
  };
}
