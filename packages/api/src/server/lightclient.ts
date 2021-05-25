import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {serializeProof} from "@chainsafe/persistent-merkle-tree";
import {ServerRoutes, getGenericJsonServer} from "./utils";
import {Api, ReqTypes, routesData, getReturnTypes, getReqSerializers} from "../routes/lightclient";

export function getRoutes(config: IBeaconConfig, api: Api): ServerRoutes<Api, ReqTypes> {
  const reqSerializers = getReqSerializers();
  const serverRoutes = getGenericJsonServer<Api, ReqTypes>(
    {routesData, getReturnTypes, getReqSerializers},
    config,
    api
  );

  return {
    ...serverRoutes,

    getStateProof: {
      ...serverRoutes.getStateProof,
      handler: async (req, res) => {
        const args = reqSerializers.getStateProof.parseReq(req);
        const {data: proof} = await api.getStateProof(...args);
        const serialized = serializeProof(proof);
        return res.status(200).header("Content-Type", "application/octet-stream").send(Buffer.from(serialized));
      },
    },
  };
}
