import {IChainForkConfig} from "@lodestar/config";
import {
  ClientOptions,
  generateGenericJsonClient,
  getFetchOptsSerializers,
  IHttpClient,
} from "../../utils/client/index.js";
import {ReturnTypes} from "../../utils/types.js";
import {StateId} from "../routes/beacon/state.js";
import {Api, getReqSerializers, getReturnTypes, ReqTypes, routesData, StateFormat} from "../routes/debug.js";
import {defaultClientOptions} from "./index.js";

// As Jul 2022, it takes up to 3 mins to download states so make this 5 mins for reservation
const GET_STATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * REST HTTP client for debug routes
 */
export function getClient<ErrorAsResponse extends boolean = false>(
  _config: IChainForkConfig,
  httpClient: IHttpClient,
  options?: ClientOptions<ErrorAsResponse>
): Api<ErrorAsResponse> {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // Some routes return JSON, use a client auto-generator
  const client = generateGenericJsonClient<Api<ErrorAsResponse>, ReqTypes, ErrorAsResponse>(
    routesData,
    reqSerializers,
    returnTypes as ReturnTypes<Api<ErrorAsResponse>>,
    httpClient,
    options ?? (defaultClientOptions as ClientOptions<ErrorAsResponse>)
  );
  // For `getState()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,

    // TODO: Debug the type issue
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    async getState(stateId: string, format?: StateFormat) {
      if (format === "ssz") {
        const res = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getState(stateId, format),
          timeoutMs: GET_STATE_TIMEOUT_MS,
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return {
          ok: true,
          res: {data: new Uint8Array(res.body)},
          status: 200,
        };
      }
      return client.getState(stateId, format);
    },

    // TODO: Debug the type issue
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    async getStateV2(stateId: StateId, format?: StateFormat) {
      if (format === "ssz") {
        const res = await httpClient.arrayBuffer({
          ...fetchOptsSerializers.getStateV2(stateId, format),
          timeoutMs: GET_STATE_TIMEOUT_MS,
        });
        // Casting to any otherwise Typescript doesn't like the multi-type return
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return {ok: true, res: {data: new Uint8Array(res.body)}, status: res.status};
      }

      return client.getStateV2(stateId, format);
    },
  };
}
