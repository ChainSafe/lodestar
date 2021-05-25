import {ForkName} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/minimal";
import {routes} from "../../src";
import {runGenericServerTest} from "../utils/genericServerTest";

const root = Buffer.alloc(32, 1);

describe("debug", () => {
  runGenericServerTest<routes.debug.Api, routes.debug.ReqTypes>(config, routes.debug, {
    getHeads: {
      args: [],
      res: {data: [{slot: 1, root}]},
    },
    getState: {
      args: ["head"],
      res: {data: config.types.phase0.BeaconState.defaultValue()},
    },
    getStateV2: {
      args: ["head"],
      res: {data: config.types.altair.BeaconState.defaultValue(), version: ForkName.altair},
    },
  });
});
