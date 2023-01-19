import {IChainForkConfig} from "@lodestar/config";
import {deserializeProof} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes, routesData, getReqSerializers} from "../routes/proof.js";
import {IHttpClient, getFetchOptsSerializers, HttpError} from "../../utils/client/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();

  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    async getStateProof(stateId, paths) {
      try {
        const res = await httpClient.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, paths));
        const proof = deserializeProof(new Uint8Array(res.body));

        return {ok: true, response: {data: proof}, status: HttpStatusCode.OK};
      } catch (err) {
        if (err instanceof HttpError) {
          return {
            ok: false,
            error: {code: err.status, message: err.message, operationId: "proof.getStateProof"},
            status: err.status,
          };
        }
        throw err;
      }
    },
  };
}
