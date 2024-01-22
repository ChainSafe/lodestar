import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/beacon/index.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers(config);
  const returnTypes = getReturnTypes();

  // Most of routes return JSON, use a server auto-generator
  const serverRoutes = getGenericJsonServer<ServerApi<Api>, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );
  return {
    ...serverRoutes,
    // Non-JSON routes. Return JSON or binary depending on "accept" header
    getBlock: {
      ...serverRoutes.getBlock,
      handler: async (req) => {
        const response = await api.getBlock(...reqSerializers.getBlock.parseReq(req));
        if (response instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          return returnTypes.getBlock.toJson(response);
        }
      },
    },
    getBlockV2: {
      ...serverRoutes.getBlockV2,
      handler: async (req, res) => {
        const response = await api.getBlockV2(...reqSerializers.getBlockV2.parseReq(req));
        if (response instanceof Uint8Array) {
          const slot = extractSlotFromBlockBytes(response);
          const version = config.getForkName(slot);
          void res.header("Eth-Consensus-Version", version);
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          void res.header("Eth-Consensus-Version", response.version);
          return returnTypes.getBlockV2.toJson(response);
        }
      },
    },
  };
}

function extractSlotFromBlockBytes(block: Uint8Array): number {
  const {signature} = ssz.phase0.SignedBeaconBlock.fields;
  /**
   * class SignedBeaconBlock(Container):
   *   message: BeaconBlock                 [offset - 4 bytes]
   *   signature: BLSSignature              [fixed - 96 bytes]
   *
   * class BeaconBlock(Container):
   *   slot: Slot                           [fixed - 8 bytes]
   *   ...
   */
  const offset = 4 + signature.lengthBytes;
  const bytes = block.subarray(offset, offset + ssz.Slot.byteLength);
  return ssz.Slot.deserialize(bytes);
}
