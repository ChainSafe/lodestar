// import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {ApplicationMethods, FastifyRoutes, createFastifyRoutes} from "../../utils/server/index.js";
import {Endpoints, getDefinitions} from "../routes/proof.js";

// TODO: revisit, do we need still need to override handlers?

export function getRoutes(config: ChainForkConfig, methods: ApplicationMethods<Endpoints>): FastifyRoutes<Endpoints> {
  return createFastifyRoutes(getDefinitions(config), methods);
  // const serverRoutes = createFastifyRoutes(definitions, methods);

  // return {
  //   // Non-JSON routes. Return binary
  //   getStateProof: {
  //     ...serverRoutes.getStateProof,
  //     handler: async (req) => {
  //       const args = definitions.getStateProof.req.parseReq(req);
  //       const {data} = await methods.getStateProof(args);
  //       const leaves = (data as CompactMultiProof).leaves;
  //       const response = new Uint8Array(32 * leaves.length);
  //       for (let i = 0; i < leaves.length; i++) {
  //         response.set(leaves[i], i * 32);
  //       }
  //       // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
  //       return Buffer.from(response);
  //     },
  //   },
  //   getBlockProof: {
  //     ...serverRoutes.getBlockProof,
  //     handler: async (req) => {
  //       const args = definitions.getBlockProof.req.parseReq(req);
  //       const {data} = await methods.getBlockProof(args);
  //       const leaves = (data as CompactMultiProof).leaves;
  //       const response = new Uint8Array(32 * leaves.length);
  //       for (let i = 0; i < leaves.length; i++) {
  //         response.set(leaves[i], i * 32);
  //       }
  //       // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
  //       return Buffer.from(response);
  //     },
  //   },
  // };
}
