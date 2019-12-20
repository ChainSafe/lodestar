import {IFastifyServer} from "../../../index";
import fastify, {DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {getAttesterDuties} from "../../../../impl/validator";
import {PublicKey} from "@chainsafe/bls";
import {toJson} from "@chainsafe/eth2.0-utils";

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
            types: "string"
          }
        }
      }
    },
  }
};

export const registerAttesterDutiesEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<IQuery, IParams>(
    "/duties/:epoch/attester",
    opts,
    async (request, reply) => {
      const response = (await getAttesterDuties(
        modules.config,
        modules.db,
        request.params.epoch,
        request.query.validator_pubkeys.map((pubKey) => {
          try {
            return PublicKey.fromBytes(
              Buffer.from(
                pubKey.replace("0x", ""),
                "hex"
              )
            ).toBytesCompressed();
          } catch (e) {
            return null;
          }
        }).filter(pubKey => !!pubKey)
      )).map(toJson);
      reply
        .code(200)
        .type("application/json")
        .send(response);
    }
  );
};