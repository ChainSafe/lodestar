import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {OnlySupportedByDVT} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildSubmitBeaconCommitteeSelections(
  _modules: ApiModules,
  _dep: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["submitBeaconCommitteeSelections"] {
  return async function submitBeaconCommitteeSelections() {
    throw new OnlySupportedByDVT();
  };
}
