import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromHexString} from "@chainsafe/ssz";
import {LodestarRestApiEndpoint} from "../../../interface";

interface IParams extends DefaultParams {
  epoch: number;
}

interface IQuery extends DefaultQuery {
  // eslint-disable-next-line camelcase
  validator_pubkeys: string[];
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, IQuery, IParams> = {
  schema: {
    params: {
      type: "object",
      required: ["epoch"],
      properties: {
        epoch: {
          type: "integer",
          minimum: 0
        }
      }
    },
    querystring: {
      type: "object",
      required: ["validator_pubkeys"],
      properties: {
        "validator_pubkeys": {
          type: "array",
          maxItems: 5,
          items: {
            type: "string"
          }
        }
      }
    },
  }
};

export const registerAttesterDutiesEndpoint: LodestarRestApiEndpoint = (fastify, {api, config}): void => {
  fastify.get<IQuery, IParams>(
    "/duties/:epoch/attester",
    opts,
    async (request, reply) => {
      const responseValue = await api.validator.getAttesterDuties(
        request.params.epoch,
        request.query.validator_pubkeys.map((pubKeyHex) => fromHexString(pubKeyHex))
      );
      reply
        .code(200)
        .type("application/json")
        .send(responseValue.map((value) => {
          return config.types.AttesterDuty.toJson(
            value, {case: "snake"}
          );
        }));
    }
  );
};
