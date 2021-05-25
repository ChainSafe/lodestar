import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconParams} from "@chainsafe/lodestar-params";
import {routes} from "../../src";
import {runGenericServerTest} from "../utils/genericServerTest";

describe("config", () => {
  runGenericServerTest<routes.config.Api, routes.config.ReqTypes>(config, routes.config, {
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
