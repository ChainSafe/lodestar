import {config} from "@chainsafe/lodestar-config/default";
import {
  Api,
  DeleteRemoteKeyStatus,
  DeletionStatus,
  ImportRemoteKeyStatus,
  ImportStatus,
  ReqTypes,
} from "../../../src/keymanager/routes.js";
import {getClient} from "../../../src/keymanager/client.js";
import {getRoutes} from "../../../src/keymanager/server/index.js";
import {runGenericServerTest} from "../../utils/genericServerTest.js";

describe("keymanager", () => {
  // randomly pregenerated pubkey
  const pubkeyRand =
    "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";

  runGenericServerTest<Api, ReqTypes>(config, getClient, getRoutes, {
    listKeys: {
      args: [],
      res: {
        data: [
          {
            validatingPubkey: pubkeyRand,
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

    listRemoteKeys: {
      args: [],
      res: {
        data: [
          {
            pubkey: pubkeyRand,
            url: "https://sign.er",
            readonly: false,
          },
        ],
      },
    },
    importRemoteKeys: {
      args: [[{pubkey: pubkeyRand, url: "https://sign.er"}]],
      res: {data: [{status: ImportRemoteKeyStatus.imported}]},
    },
    deleteRemoteKeys: {
      args: [["key1"]],
      res: {data: [{status: DeleteRemoteKeyStatus.deleted}]},
    },
  });
});
