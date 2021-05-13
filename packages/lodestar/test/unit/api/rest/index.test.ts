import {config} from "@chainsafe/lodestar-config/mainnet";

import {ApiNamespace, RestApi} from "../../../../src/api";
import {StubbedApi} from "../../../utils/stub/api";
import {testLogger} from "../../../utils/logger";

export async function setupRestApiTestServer(): Promise<RestApi> {
  const api = new StubbedApi();
  return await RestApi.init(
    {
      api: [
        ApiNamespace.BEACON,
        ApiNamespace.CONFIG,
        ApiNamespace.DEBUG,
        ApiNamespace.EVENTS,
        ApiNamespace.NODE,
        ApiNamespace.VALIDATOR,
        ApiNamespace.LODESTAR,
      ],
      cors: "*",
      enabled: true,
      host: "127.0.0.1",
      port: 0,
    },
    {config, logger: testLogger(), api, metrics: null}
  );
}
