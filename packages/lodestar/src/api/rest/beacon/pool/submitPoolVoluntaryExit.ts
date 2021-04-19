import {phase0} from "@chainsafe/lodestar-types";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

export const submitPoolVoluntaryExit: ApiController = {
  url: "/pool/voluntary_exits",
  method: "POST",
  id: "submitPoolVoluntaryExit",

  handler: async function (req) {
    let exit: phase0.SignedVoluntaryExit;
    try {
      exit = this.config.types.phase0.SignedVoluntaryExit.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError(`SSZ deserialize error: ${(e as Error).message}`);
    }
    await this.api.beacon.pool.submitVoluntaryExit(exit);
    return {};
  },

  schema: {
    body: {
      type: "object",
    },
  },
};
