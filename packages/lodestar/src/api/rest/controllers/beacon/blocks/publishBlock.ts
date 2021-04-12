import {phase0} from "@chainsafe/lodestar-types";
import {ApiController} from "../../types";
import {ValidationError} from "../../../../impl/errors";

export const publishBlock: ApiController = {
  url: "/blocks",
  method: "POST",

  handler: async function (req) {
    let block: phase0.SignedBeaconBlock;
    try {
      block = this.config.types.phase0.SignedBeaconBlock.fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError(`Failed to deserialize block: ${(e as Error).message}`);
    }
    await this.api.beacon.blocks.publishBlock(block);
    return {};
  },

  schema: {
    body: {
      type: "object",
    },
  },
};
