import {phase0} from "@chainsafe/lodestar-types";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

export const publishBlock: ApiController = {
  url: "/eth/v1/beacon/blocks",
  method: "POST",
  id: "publishBlock",

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
