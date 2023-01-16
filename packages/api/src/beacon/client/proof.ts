import {IChainForkConfig} from "@lodestar/config";
import {deserializeProof, Proof} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes, routesData, getReqSerializers} from "../routes/proof.js";
import {IHttpClient, getFetchOptsSerializers, ClientOptions, HttpError} from "../../utils/client/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {APIClientResponse} from "../../utils/types.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient<ErrorAsResponse extends boolean = false>(
  _config: IChainForkConfig,
  httpClient: IHttpClient,
  options?: ClientOptions<ErrorAsResponse>
): Api<ErrorAsResponse> {
  const reqSerializers = getReqSerializers();

  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    async getStateProof(stateId, paths) {
      try {
        const res = await httpClient.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, paths));
        const proof = deserializeProof(new Uint8Array(res.body));

        return {ok: true, res: {data: proof}, status: HttpStatusCode.OK} as APIClientResponse<
          {[HttpStatusCode.OK]: {data: Proof}},
          HttpStatusCode.INTERNAL_SERVER_ERROR,
          ErrorAsResponse
        >;
      } catch (err) {
        if (err instanceof HttpError && options?.errorAsResponse) {
          return {
            ok: false,
            res: {code: err.status, message: err.message},
            status: err.status,
          } as APIClientResponse<
            {[HttpStatusCode.OK]: {data: Proof}},
            HttpStatusCode.INTERNAL_SERVER_ERROR,
            ErrorAsResponse
          >;
        }
        throw err;
      }
    },
  };
}
