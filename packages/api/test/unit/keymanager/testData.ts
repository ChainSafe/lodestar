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

  getFeeRecipient: {
    args: ["key1"],
    res: {data: {pubkey: "key1", ethaddress: "eth1"}},
  },
  setFeeRecipient: {
    args: ["key1", "eth1"],
    res: undefined,
  },
  deleteFeeRecipient: {
    args: ["key1"],
    res: undefined,
  },

  getGasLimit: {
    args: ["key1"],
    res: {data: {pubkey: "key1", gasLimit: "300"}},
  },
  setGasLimit: {
    args: ["key1", "300"],
    res: undefined,
  },
  deleteGasLimit: {
    args: ["key1"],
    res: undefined,
  },
};
