import {phase0} from "@chainsafe/lodestar-types";
import {ValidationError} from "../../../../impl/errors/validation";
import {ApiController} from "../../types";

export const submitAttesterSlashing: ApiController = {
  url: "/pool/attester_slashings",
  method: "POST",

  handler: async function (req) {
    let slashing: phase0.AttesterSlashing;
    try {
      slashing = this.config.types.phase0.AttesterSlashing.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError("Failed to deserialize attester slashing");
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
