import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {Api, ReqTypes} from "../../src/routes/config";
import {getClient} from "../../src/client/config";
import {getRoutes} from "../../src/server/config";
import {runGenericServerTest} from "../utils/genericServerTest";

describe("config", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    getDepositContract: {
      args: [],
      res: {
        data: {
          chainId: 1,
          address: Buffer.alloc(20, 1),
        },
      },
    },
    getForkSchedule: {
      args: [],
      res: {data: [config.types.phase0.Fork.defaultValue()]},
    },
    getSpec: {
      args: [],
      res: {data: BeaconParams.defaultValue()},
    },
  });
});
