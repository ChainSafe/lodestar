import {ServerApi, routes} from "@lodestar/api";
import {ApiModules} from "../../types.js";
import {ApiError} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildGetLiveness(
  {chain}: ApiModules,
  _deps: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["getLiveness"] {
  return async function getLiveness(epoch, validatorIndices) {
    if (validatorIndices.length === 0) {
      return {
        data: [],
      };
    }
    const currentEpoch = chain.clock.currentEpoch;
    if (epoch < currentEpoch - 1 || epoch > currentEpoch + 1) {
      throw new ApiError(
        400,
        `Request epoch ${epoch} is more than one epoch before or after the current epoch ${currentEpoch}`
      );
    }

    return {
      data: validatorIndices.map((index) => ({
        index,
        isLive: chain.validatorSeenAtEpoch(index, epoch),
      })),
    };
  };
}
