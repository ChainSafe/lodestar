import {ChainForkConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/debug.js";
import {ServerRoutes, getGenericJsonServer} from "../../utils/server/index.js";
import {ServerApi} from "../../interfaces.js";

export function getRoutes(config: ChainForkConfig, api: ServerApi<Api>): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();

  const serverRoutes = getGenericJsonServer<ServerApi<Api>, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    // Non-JSON routes. Return JSON or binary depending on "accept" header
    getState: {
      ...serverRoutes.getState,
      handler: async (req) => {
        const response = await api.getState(...reqSerializers.getState.parseReq(req));
        if (response instanceof Uint8Array) {
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          return returnTypes.getState.toJson(response);
        }
      },
    },
    getStateV2: {
      ...serverRoutes.getStateV2,
      handler: async (req, res) => {
        const response = await api.getStateV2(...reqSerializers.getStateV2.parseReq(req));
        if (response instanceof Uint8Array) {
          const slot = extractSlotFromStateBytes(response);
          const version = config.getForkName(slot);
          void res.header("Eth-Consensus-Version", version);
          // Fastify 3.x.x will automatically add header `Content-Type: application/octet-stream` if Buffer
          return Buffer.from(response);
        } else {
          void res.header("Eth-Consensus-Version", response.version);
          return returnTypes.getStateV2.toJson(response);
        }
      },
    },
  };
}

function extractSlotFromStateBytes(state: Uint8Array): number {
  const {genesisTime, genesisValidatorsRoot} = ssz.phase0.BeaconState.fields;
  /**
   * class BeaconState(Container):
   *   genesisTime: BeaconBlock             [offset - 4 bytes]
   *   genesisValidatorsRoot: BLSSignature  [fixed - 96 bytes]
   *   slot: Slot                           [fixed - 8 bytes]
   *   ...
   */
  const offset = genesisTime.byteLength + genesisValidatorsRoot.lengthBytes;
  const bytes = state.subarray(offset, offset + ssz.Slot.byteLength);
  return ssz.Slot.deserialize(bytes);
}
