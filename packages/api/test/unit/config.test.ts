import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {Api, ReqTypes, Spec} from "../../src/routes/config";
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
      res: {data: [ssz.phase0.Fork.defaultValue()]},
    },
    getSpec: {
      args: [],
      res: {data: Spec.defaultValue()},
    },
  });
});
