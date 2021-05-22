import {routes} from "@chainsafe/lodestar-api";
import {getGenericServer, jsonOpts} from "@chainsafe/lodestar-api/lib/utils";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiController, ApiControllerGeneric, HttpHeader, MimeTypes} from "../types";

export function getRoutes(
  config: IBeaconConfig,
  api: routes.debug.Api
): {[K in keyof routes.debug.Api]: ApiControllerGeneric} {
  const reqsSerdes = routes.debug.getReqSerdes();
  const returnTypes = routes.debug.getReturnTypes(config);

  const getStateHandler: ApiController<null, {stateId: string}>["handler"] = async function (req, resp) {
    const args = reqsSerdes.getState.parseReq(req);
    const resData = await this.api.debug.beacon.getState(...args);

    const type = this.config.getForkTypes(resData.slot).BeaconState;
    if (req.headers[HttpHeader.ACCEPT] === MimeTypes.SSZ) {
      return resp
        .status(200)
        .header(HttpHeader.CONTENT_TYPE, MimeTypes.SSZ)
        .send(type.serialize(resData) as Buffer);
    } else {
      // Send 200 JSON
      return type.toJson(resData, jsonOpts);
    }
  };

  const serverRoutes = getGenericServer<routes.debug.Api, routes.debug.ReqTypes>(
    routes.debug.routesData,
    reqsSerdes,
    returnTypes,
    api
  );

  return {
    getHeads: serverRoutes.getHeads,
    getState: {...serverRoutes.getState, handler: getStateHandler},
    getStateV2: {...serverRoutes.getStateV2, handler: getStateHandler},
  };
}
