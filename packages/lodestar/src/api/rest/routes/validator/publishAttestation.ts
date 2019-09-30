import {IFastifyServer} from "../../index";
import fastify, {DefaultBody, DefaultHeaders, DefaultParams, DefaultQuery} from "fastify";
import {IApiModules} from "../../../interface";
import {IncomingMessage, Server, ServerResponse} from "http";
import {fromJson} from "@chainsafe/eth2.0-utils";
import {Attestation} from "@chainsafe/eth2.0-types";
import {hashTreeRoot} from "@chainsafe/ssz";

interface IBody extends DefaultBody {
  attestation: object;
}


const opts: fastify.RouteShorthandOptions<
Server, IncomingMessage, ServerResponse, DefaultQuery, DefaultParams, DefaultHeaders, IBody> = {
  schema: {
    body: {
      type: "object",
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
  fastify.post<DefaultQuery, DefaultParams, DefaultQuery, IBody>(
    "/attestation",
    opts,
    async (request, reply) => {
      let statusCode = 200;
      try {
        const attestation = fromJson<Attestation>(
          request.body.attestation,
          modules.config.types.Attestation
        );
        if(!await modules.opPool.attestations.verifyAndReceive(
          modules.chain.latestState, attestation
        )) {
          statusCode = 202;
          const attestationHash = hashTreeRoot(attestation, modules.config.types.Attestation);
          modules.logger.error(`Cannot verify attestation ${attestationHash.toString("hex")}`);
        }
      } catch (e) {
        modules.logger.error(e.message);
      }
      reply
        .code(statusCode)
        .type("application/json")
        .send();
    }
  );
};