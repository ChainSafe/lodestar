import {ApiController} from "../types";
import {fromHex} from "@chainsafe/lodestar-utils";

type Params = {
  slot: number;
};
type Query = {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  randao_reveal: string;
  grafitti: string;
};

export const produceBlockController: ApiController<Query, Params> = {
  url: "/blocks/:slot",
  method: "GET",

  handler: async function (req, resp) {
    const block = await this.api.validator.produceBlock(
      req.params.slot,
      fromHex(req.query.randao_reveal),
      req.query.grafitti
    );
    resp
      .code(200)
      .type("application/json")
      .send({
        data: this.config.types.phase0.BeaconBlock.toJson(block, {case: "snake"}),
      });
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
        // eslint-disable-next-line @typescript-eslint/naming-convention
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
