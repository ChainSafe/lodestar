import {config} from "@chainsafe/lodestar-config/minimal";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {routes} from "../../src";
import {runGenericServerTest} from "../utils/genericServerTest";

const root = Buffer.alloc(32, 1);

describe("lightclient", () => {
  const lightClientUpdate = config.types.altair.LightClientUpdate.defaultValue();

  runGenericServerTest<routes.lightclient.Api, routes.lightclient.ReqTypes>(config, routes.lightclient, {
    createStateProof: {
      args: [
        "head",
        [
          ["validator", 0, "balance"],
          ["finalized_checkpoint", "root"],
        ],
      ],
      res: {
        data: {
          type: ProofType.treeOffset,
          offsets: [1, 2, 3, 4],
          leaves: [root, root, root, root],
        },
      },
    },
    getBestUpdates: {
      args: [1, 2],
      res: {data: [lightClientUpdate]},
    },
    getLatestUpdateFinalized: {
      args: [],
      res: {data: lightClientUpdate},
    },
    getLatestUpdateNonFinalized: {
      args: [],
      res: {data: lightClientUpdate},
    },
  });
});
