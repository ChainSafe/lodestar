import {ApiController} from "../types";
import {fromHex} from "@chainsafe/lodestar-utils";
import {getBeaconBlockSSZType} from "../../../../util/types";

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
        data: getBeaconBlockSSZType(this.config, block).toJson(block, {case: "snake"}),
      });
  },

  opts: {
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
  },
};
