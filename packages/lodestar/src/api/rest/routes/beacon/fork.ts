import {IFastifyServer} from "../../index";
import * as fastify from "fastify";
import {IApiModules} from "../../../interface";
import {BeaconState, uint64} from "@chainsafe/eth2.0-types";
import {getFork} from "../../../impl/beacon/fork";

export const registerForkEndpoint = (fastify: IFastifyServer, modules: IApiModules): void => {
  fastify.get<fastify.DefaultQuery, {}, unknown>("/fork", {}, async (request, reply) => {
    reply.code(200).type('application/json').send(await getFork(modules.db, modules.chain));
  });
};