import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes} from "../../src/routes/lightclient";
import {getClient} from "../../src/client/lightclient";
import {getRoutes} from "../../src/server/lightclient";
import {runGenericServerTest} from "../utils/genericServerTest";

const root = Uint8Array.from(Buffer.alloc(32, 1));

describe("lightclient", () => {
  const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    getStateProof: {
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
          offsets: [1, 2, 3],
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
    getInitProof: {
      args: ["0x00"],
      res: {
        data: {
          type: ProofType.treeOffset,
          offsets: [1, 2, 3],
          leaves: [root, root, root, root],
        },
      },
    },
  });
});
