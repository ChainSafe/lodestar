import {IChainForkConfig} from "@lodestar/config";
import {generateGenericJsonClient, getFetchOptsSerializers, IHttpClient} from "../../utils/client/index.js";
import {Api, getReqSerializers, getReturnTypes, NodeHealth, ReqTypes, routesData} from "../routes/node.js";

/**
 * REST HTTP client for beacon routes
 */
export function getClient(_config: IChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();
  const returnTypes = getReturnTypes();
  // All routes return JSON, use a client auto-generator
  const client = generateGenericJsonClient<Api, ReqTypes>(routesData, reqSerializers, returnTypes, httpClient);
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    ...client,
    async getHealth(): Promise<NodeHealth> {
      return await httpClient.request({...fetchOptsSerializers.getHealth()});
    },
  };
}
