import {DefaultParams, DefaultQuery} from "fastify";
import {SignedBeaconBlock} from "../../../../../../../lodestar-types/lib/types/block";
import {getSignedBeaconBlockSSZTypeBySlot} from "@chainsafe/lodestar-utils";
import {ValidationError} from "../../../../impl/errors/validation";
import {ApiController} from "../../types";

type Body = {
  message: {
    slot: number;
  };
};

export const publishBlock: ApiController<DefaultQuery, DefaultParams, Body> = {
  url: "/blocks",

  handler: async function (req, resp) {
    let block: SignedBeaconBlock;
    try {
      block = getSignedBeaconBlockSSZTypeBySlot(this.config, req.body.message.slot).fromJson(req.body, {case: "snake"});
    } catch (e) {
      throw new ValidationError("Failed to deserialize block");
    }
    await this.api.beacon.blocks.publishBlock(block);
    resp.code(200).type("application/json").send();
  },

  opts: {
    schema: {
      body: {
        type: "object",
        additionalProperties: true,
        properties: {
          message: {
            type: "object",
            additionalProperties: true,
            properties: {
              slot: {
                type: "number",
              },
            },
          },
        },
      },
    },
  },
};
