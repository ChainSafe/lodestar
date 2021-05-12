import {ApiController} from "../../types";
import {getSignedBlockType} from "../../../../util/multifork";

// V2 handler is backwards compatible so re-use it for both versions
const handler: ApiController<null, {blockId: string}>["handler"] = async function (req) {
  const block = await this.api.beacon.blocks.getBlock(req.params.blockId);
  const type = getSignedBlockType(this.config, block);
  return {
    version: this.config.getForkName(block.message.slot),
    data: type.toJson(block, {case: "snake"}),
  };
};

const schema = {
  params: {
    type: "object",
    required: ["blockId"],
    properties: {
      blockId: {
        types: "string",
      },
    },
  },
};

export const getBlock: ApiController<null, {blockId: string}> = {
  url: "/eth/v1/beacon/blocks/:blockId",
  method: "GET",
  id: "getBlock",
  handler,
  schema,
};

export const getBlockV2: ApiController<null, {blockId: string}> = {
  url: "/eth/v2/beacon/blocks/:blockId",
  method: "GET",
  id: "getBlockV2",
  handler,
  schema,
};
