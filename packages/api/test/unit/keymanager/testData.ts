import {
  Api,
  DeleteRemoteKeyStatus,
  DeletionStatus,
  ImportRemoteKeyStatus,
  ImportStatus,
} from "../../../src/keymanager/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";

export const testData: GenericServerTestCases<Api> = {
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
    args: [[pubkeyRand], ["pass1"], "slash_protection"],
    res: {data: [{status: ImportStatus.imported}]},
  },
  deleteKeys: {
    args: [[pubkeyRand]],
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
    args: [[pubkeyRand]],
    res: {data: [{status: DeleteRemoteKeyStatus.deleted}]},
  },
};
