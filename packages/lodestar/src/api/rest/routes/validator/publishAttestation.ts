import {IFastifyServer} from "../../index";
import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromRestJson} from "../../utils";
import {Attestation} from "@chainsafe/eth2.0-types";

interface Body extends DefaultBody {
  attestation: object;
}


const opts: fastify.RouteShorthandOptions<Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, Body> = {
  schema: {
    body: {
      type: 'object',
      required: ["attestation"],
      properties: {
        attestation: {
          type: "object"
        },
      }
    },
  }
};

export const registerAttestationPublishEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.post<DefaultQuery, DefaultParams, DefaultQuery, Body>(
    '/attestation',
    opts,
    async (request, reply) => {
      try {
        await modules.opPool.attestations.receive(
          fromRestJson<Attestation>(
            request.body.attestation,
            modules.config.types.Attestation
          )
        );
      } catch (e) {
        modules.logger.error(e.message);
      }
      reply
        .code(200)
        .type('application/json')
        .send();
    }
  );
};