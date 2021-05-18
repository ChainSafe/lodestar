import {allForks} from "@chainsafe/lodestar-types";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

// TODO: Watch https://github.com/ethereum/eth2.0-APIs/pull/142 for resolution on how to upgrade this route

export const publishBlock: ApiController = {
  url: "/eth/v1/beacon/blocks",
  method: "POST",
  id: "publishBlock",

  handler: async function (req) {
    let block: allForks.SignedBeaconBlock;
    try {
      const slot = (req.body as SignedBeaconBlock).message.slot;
      block = this.config.getTypes(slot).SignedBeaconBlock.fromJson(req.body, {case: "snake"});
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
