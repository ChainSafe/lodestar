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

export const produceBlock: ApiController<Query, Params> = {
  url: "/blocks/:slot",
  method: "GET",
  id: "produceBlock",

  handler: async function (req) {
    const block = await this.api.validator.produceBlock(
      req.params.slot,
      fromHex(req.query.randao_reveal),
      req.query.grafitti
    );
    return {
      data: this.config.types.phase0.BeaconBlock.toJson(block, {case: "snake"}),
    };
  },

  schema: {
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
  },
};
