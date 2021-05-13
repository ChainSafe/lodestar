import {phase0} from "@chainsafe/lodestar-types";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {getSignedBlockType} from "../../../../util/multifork";
import {ValidationError} from "../../../impl/errors";
import {ApiController} from "../../types";

// TODO: Watch https://github.com/ethereum/eth2.0-APIs/pull/142 for resolution on how to upgrade this route

export const publishBlock: ApiController = {
  url: "/eth/v1/beacon/blocks",
  method: "POST",
  id: "publishBlock",

  handler: async function (req) {
    const type = getSignedBlockType(this.config, req.body as SignedBeaconBlock);

    let block: phase0.SignedBeaconBlock;
    try {
      block = type.fromJson(req.body, {case: "snake"});
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
