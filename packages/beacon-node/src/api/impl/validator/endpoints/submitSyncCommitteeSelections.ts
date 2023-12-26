import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {OnlySupportedByDVT} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildSubmitSyncCommitteeSelections(
  _modules: ApiModules,
  _dep: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["submitSyncCommitteeSelections"] {
  return async function submitSyncCommitteeSelections() {
    throw new OnlySupportedByDVT();
  };
}
