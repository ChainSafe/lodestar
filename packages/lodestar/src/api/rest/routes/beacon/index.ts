import {registerVersionEndpoint} from "./version";
import {registerGenesisTimeEndpoint} from "./genesisTime";
import {registerForkEndpoint} from "./fork";
import {registerSyncingEndpoint} from "./syncing";
import {LodestarApiPlugin} from "../../interface";
import {registerBlockStreamEndpoint} from "./blockStream";
import {registerGetValidatorEndpoint} from "./validator";
import {registerHeadEndpoint} from "./head";
import {registerPeersEndpoint} from "./peers";
import {FastifyInstance} from "fastify";
import {
  getBlock,
  getBlockAttestations,
  getBlockHeader,
  getBlockHeaders,
  getBlockRoot
} from "../../controllers/beacon/blocks";

//old
export const beacon: LodestarApiPlugin = (fastify, opts, done: Function): void => {
  registerVersionEndpoint(fastify, opts);
  registerGenesisTimeEndpoint(fastify, opts);
  registerForkEndpoint(fastify, opts);
  registerSyncingEndpoint(fastify, opts);
  registerGetValidatorEndpoint(fastify, opts);
  registerBlockStreamEndpoint(fastify, opts);
  registerHeadEndpoint(fastify, opts);
  registerPeersEndpoint(fastify, opts);
  done();
};

//new
export function registerBeaconRoutes(server: FastifyInstance): void {
  server.get(getBlockHeaders.url, getBlockHeaders.opts, getBlockHeaders.handler);
  server.get(getBlockHeader.url, getBlockHeader.opts, getBlockHeader.handler);
  server.get(getBlock.url, getBlock.opts, getBlock.handler);
  server.get(getBlockRoot.url, getBlockRoot.opts, getBlockRoot.handler);
  server.get(getBlockAttestations.url, getBlockAttestations.opts, getBlockAttestations.handler);
}
