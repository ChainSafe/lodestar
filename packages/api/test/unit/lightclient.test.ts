import {ssz} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/default";
import {ProofType} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes} from "../../src/routes/lightclient";
import {getClient} from "../../src/client/lightclient";
import {getRoutes} from "../../src/server/lightclient";
import {runGenericServerTest} from "../utils/genericServerTest";
import {toHexString} from "@chainsafe/ssz";

const root = Uint8Array.from(Buffer.alloc(32, 1));

describe("lightclient", () => {
  const lightClientUpdate = ssz.altair.LightClientUpdate.defaultValue();

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    getStateProof: {
      args: [
        "head",
        [
          // ["validator", 0, "balance"],
          ["finalized_checkpoint", 0, "root", 12000],
        ],
      ],
      res: {
        data: {
          type: ProofType.treeOffset,
          offsets: [1, 2, 3],
          leaves: [root, root, root, root],
        },
      },
      /* eslint-disable quotes */
      query: {
        paths: [
          // '["validator",0,"balance"]',
          '["finalized_checkpoint",0,"root",12000]',
        ],
      },
      /* eslint-enable quotes */
    },
    getCommitteeUpdates: {
      args: [1, 2],
      res: {data: [lightClientUpdate]},
    },
    getSnapshot: {
      args: [toHexString(root)],
      res: {
        data: {
          header: ssz.phase0.BeaconBlockHeader.defaultValue(),
          currentSyncCommittee: lightClientUpdate.nextSyncCommittee,
          nextSyncCommittee: lightClientUpdate.nextSyncCommittee,
          syncCommitteesBranch: [root, root, root, root], // Vector(Root, 4)
        },
      },
    },
  });
});
