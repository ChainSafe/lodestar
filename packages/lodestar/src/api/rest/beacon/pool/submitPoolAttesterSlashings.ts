import {phase0} from "@chainsafe/lodestar-types";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

export const submitPoolAttesterSlashings: ApiController = {
  url: "/eth/v1/beacon/pool/attester_slashings",
  method: "POST",
  id: "submitPoolAttesterSlashings",

  handler: async function (req) {
    let slashing: phase0.AttesterSlashing;
    try {
      slashing = this.config.types.phase0.AttesterSlashing.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError(`SSZ deserialize error: ${(e as Error).message}`);
    }
    await this.api.beacon.pool.submitAttesterSlashing(slashing);
    return {};
  },

  schema: {
    body: {
      type: "object",
    },
  },
};
