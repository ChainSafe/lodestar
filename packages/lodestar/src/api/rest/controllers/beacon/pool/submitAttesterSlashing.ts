import {AttesterSlashing} from "../../../../../../../lodestar-types/lib/types/operations";
import {ValidationError} from "../../../../impl/errors/validation";
import {ApiController} from "../../types";

export const submitAttesterSlashing: ApiController = {
  url: "/pool/attester_slashings",

  handler: async function (req, resp) {
    let slashing: AttesterSlashing;
    try {
      slashing = this.config.types.AttesterSlashing.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError("Failed to deserialize attester slashing");
    }
    await this.api.beacon.pool.submitAttesterSlashing(slashing);
    resp.status(200).send();
  },

  opts: {
    schema: {
      body: {
        type: "object",
      },
    },
  },
};
