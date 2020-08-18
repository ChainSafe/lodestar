import {registerForkEndpoint} from "./fork";
import {LodestarApiPlugin} from "../../interface";
import {registerBlockStreamEndpoint} from "./blockStream";
import {registerGetValidatorEndpoint} from "./validator";
import {FastifyInstance} from "fastify";
import {
  getBlock,
  getBlockAttestations,
  getBlockHeader,
  getBlockHeaders,
  getBlockRoot,
  getGenesis,
  getPoolAttestations, getStateFinalityCheckpoints
} from "../../controllers/beacon";

//old
export const beacon: LodestarApiPlugin = (fastify, opts, done: Function): void => {
  registerForkEndpoint(fastify, opts);
  registerGetValidatorEndpoint(fastify, opts);
  registerBlockStreamEndpoint(fastify, opts);
  done();
};

//new
export function registerBeaconRoutes(server: FastifyInstance): void {
  server.get(getGenesis.url, getGenesis.opts, getGenesis.handler);

  //state
  server.get(getStateFinalityCheckpoints.url, getStateFinalityCheckpoints.opts, getStateFinalityCheckpoints.handler);

  //pool
  server.get(getPoolAttestations.url, getPoolAttestations.opts, getPoolAttestations.handler);

  //blocks
  server.get(getBlockHeaders.url, getBlockHeaders.opts, getBlockHeaders.handler);
  server.get(getBlockHeader.url, getBlockHeader.opts, getBlockHeader.handler);
  server.get(getBlock.url, getBlock.opts, getBlock.handler);
  server.get(getBlockRoot.url, getBlockRoot.opts, getBlockRoot.handler);
  server.get(getBlockAttestations.url, getBlockAttestations.opts, getBlockAttestations.handler);
}
