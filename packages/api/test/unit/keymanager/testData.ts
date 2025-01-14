import {ssz} from "@lodestar/types";
import {
  DeleteRemoteKeyStatus,
  DeletionStatus,
  Endpoints,
  ImportRemoteKeyStatus,
  ImportStatus,
} from "../../../src/keymanager/routes.js";
import {GenericServerTestCases} from "../../utils/genericServerTest.js";

// randomly pregenerated pubkey
const pubkeyRand = "0x84105a985058fc8740a48bf1ede9d223ef09e8c6b1735ba0a55cf4a9ff2ff92376b778798365e488dab07a652eb04576";
const ethaddressRand = "0xabcf8e0d4e9587369b2301d0790347320302cc09";
const graffitiRandUtf8 = "636861696e736166652f6c6f64657374";
const gasLimitRand = 36_000_000;
const builderBoostFactorRand = BigInt(100);

export const testData: GenericServerTestCases<Endpoints> = {
  listKeys: {
    args: undefined,
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
    args: {keystores: ["keystore"], passwords: ["pass1"], slashingProtection: "slash_protection"},
    res: {data: [{status: ImportStatus.imported}]},
  },
  deleteKeys: {
    args: {pubkeys: [pubkeyRand]},
    res: {data: {statuses: [{status: DeletionStatus.deleted}], slashingProtection: "slash_protection"}},
  },

  listRemoteKeys: {
    args: undefined,
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
    args: {remoteSigners: [{pubkey: pubkeyRand, url: "https://sign.er"}]},
    res: {data: [{status: ImportRemoteKeyStatus.imported}]},
  },
  deleteRemoteKeys: {
    args: {pubkeys: [pubkeyRand]},
    res: {data: [{status: DeleteRemoteKeyStatus.deleted}]},
  },

  listFeeRecipient: {
    args: {pubkey: pubkeyRand},
    res: {data: {pubkey: pubkeyRand, ethaddress: ethaddressRand}},
  },
  setFeeRecipient: {
    args: {pubkey: pubkeyRand, ethaddress: ethaddressRand},
    res: undefined,
  },
  deleteFeeRecipient: {
    args: {pubkey: pubkeyRand},
    res: undefined,
  },

  getGraffiti: {
    args: {pubkey: pubkeyRand},
    res: {data: {pubkey: pubkeyRand, graffiti: graffitiRandUtf8}},
  },
  setGraffiti: {
    args: {pubkey: pubkeyRand, graffiti: graffitiRandUtf8},
    res: undefined,
  },
  deleteGraffiti: {
    args: {pubkey: pubkeyRand},
    res: undefined,
  },

  getGasLimit: {
    args: {pubkey: pubkeyRand},
    res: {data: {pubkey: pubkeyRand, gasLimit: gasLimitRand}},
  },
  setGasLimit: {
    args: {pubkey: pubkeyRand, gasLimit: gasLimitRand},
    res: undefined,
  },
  deleteGasLimit: {
    args: {pubkey: pubkeyRand},
    res: undefined,
  },
  signVoluntaryExit: {
    args: {pubkey: pubkeyRand, epoch: 1},
    res: {data: ssz.phase0.SignedVoluntaryExit.defaultValue()},
  },
  getBuilderBoostFactor: {
    args: {pubkey: pubkeyRand},
    res: {data: {pubkey: pubkeyRand, builderBoostFactor: builderBoostFactorRand}},
  },
  setBuilderBoostFactor: {
    args: {pubkey: pubkeyRand, builderBoostFactor: builderBoostFactorRand},
    res: undefined,
  },
  deleteBuilderBoostFactor: {
    args: {pubkey: pubkeyRand},
    res: undefined,
  },
  getProposerConfig: {
    args: {pubkey: pubkeyRand},
    res: {
      data: {
        graffiti: graffitiRandUtf8,
        strictFeeRecipientCheck: false,
        feeRecipient: ethaddressRand,
        builder: {
          gasLimit: gasLimitRand,
          selection: "maxprofit",
          boostFactor: builderBoostFactorRand.toString(),
        },
      },
    },
  },
};
