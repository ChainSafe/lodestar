import {config} from "@chainsafe/lodestar-config/default";
import {Api, DeletionStatus, ImportStatus, ReqTypes} from "../../src/keymanager/routes.js";
import {getClient} from "../../src/keymanager/client.js";
import {getRoutes} from "../../src/keymanager/server.js";
import {runGenericServerTest} from "../utils/genericServerTest.js";

describe("keymanager", () => {
  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    listKeys: {
      args: [],
      res: {
        data: [
          {
            validatingPubkey:
              // randomly pregenerated pubkey
              "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576",
            derivationPath: "m/12381/3600/0/0/0",
            readonly: false,
          },
        ],
      },
    },
    importKeystores: {
      args: [["key1"], ["pass1"], "slash_protection"],
      res: {data: [{status: ImportStatus.imported}]},
    },
    deleteKeystores: {
      args: [["key1"]],
      res: {data: [{status: DeletionStatus.deleted}], slashingProtection: "slash_protection"},
    },
  });
});
