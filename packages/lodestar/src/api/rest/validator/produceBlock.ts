import {fromHex} from "@chainsafe/lodestar-utils";
import {ApiController} from "../types";

/* eslint-disable @typescript-eslint/naming-convention */

type Params = {
  slot: number;
};
type Query = {
  randao_reveal: string;
  grafitti: string;
};

// V2 handler is backwards compatible so re-use it for both versions
const handler: ApiController<Query, Params>["handler"] = async function (req) {
  const block = await this.api.validator.produceBlock(
    req.params.slot,
    fromHex(req.query.randao_reveal),
    req.query.grafitti
  );
  return {
    version: this.config.getForkName(block.slot),
    data: this.config.getForkTypes(block.slot).BeaconBlock.toJson(block, {case: "snake"}),
  };
};

const schema = {
  params: {
    type: "object",
    required: ["slot"],
    properties: {
      slot: {
        type: "number",
        minimum: 1,
      },
    },
  },
  querystring: {
    type: "object",
    required: ["randao_reveal"],
    properties: {
      randao_reveal: {
        type: "string",
        //TODO: add hex string signature regex
      },
      graffiti: {
        type: "string",
        maxLength: 64,
      },
    },
  },
};

export const produceBlock: ApiController<Query, Params> = {
  url: "/eth/v1/validator/blocks/:slot",
  method: "GET",
  id: "produceBlock",
  handler,
  schema,
};

export const produceBlockV2: ApiController<Query, Params> = {
  url: "/eth/v2/validator/blocks/:slot",
  method: "GET",
  id: "produceBlockV2",
  handler,
  schema,
};
