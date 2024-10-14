import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {toBufferBE} from "bigint-buffer";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {chainConfig} from "@lodestar/config/default";
import {bellatrix} from "@lodestar/types";
import {routes} from "@lodestar/api";

import {ValidatorStore} from "../../src/services/validatorStore.js";
import {getApiClientStub} from "../utils/apiStub.js";
import {initValidatorStore} from "../utils/validatorStore.js";
import {ValidatorProposerConfig} from "../../src/services/validatorStore.js";

describe("ValidatorStore", () => {
  const api = getApiClientStub();

  let validatorStore: ValidatorStore;

  let valProposerConfig: ValidatorProposerConfig;

  beforeEach(async () => {
    valProposerConfig = {
      proposerConfig: {
        [toHexString(pubkeys[0])]: {
          graffiti: "graffiti",
          strictFeeRecipientCheck: true,
          feeRecipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          builder: {
            gasLimit: 30000000,
            selection: routes.validator.BuilderSelection.ExecutionOnly,
          },
        },
      },
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: false,
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
        builder: {
          gasLimit: 35000000,
        },
      },
    };

    validatorStore = await initValidatorStore(secretKeys, api, chainConfig, valProposerConfig);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("Should validate graffiti,feeRecipient etc. from valProposerConfig and ValidatorStore", async () => {
    //pubkeys[0] values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[0]))).toBe(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].graffiti
    );
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[0]))).toBe(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].feeRecipient
    );
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[0]))).toBe(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[0]))).toBe(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder?.gasLimit
    );

    // default values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[1]))).toBe(valProposerConfig.defaultConfig.graffiti);
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[1]))).toBe(valProposerConfig.defaultConfig.feeRecipient);
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[1]))).toBe(
      valProposerConfig.defaultConfig.strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[1]))).toBe(valProposerConfig.defaultConfig.builder?.gasLimit);
  });

  it("Should create/update builder data and return from cache next time", async () => {
    let slot = 0;
    const testCases: [bellatrix.SignedValidatorRegistrationV1, string, number][] = [
      [valRegF00G100, "0x00", 100],
      [valRegF10G100, "0x10", 100],
      [valRegF10G200, "0x10", 200],
    ];
    for (const [valReg, feeRecipient, gasLimit] of testCases) {
      vi.spyOn(validatorStore, "signValidatorRegistration").mockResolvedValue(valReg);

      const val1 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val1)).toEqual(JSON.stringify(valReg));
      expect(validatorStore.signValidatorRegistration).toHaveBeenCalledOnce();
      const val2 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val2)).toEqual(JSON.stringify(valReg));
      expect(validatorStore.signValidatorRegistration).toHaveBeenCalledOnce();
    }
  });
});

const secretKeys = Array.from({length: 3}, (_, i) => SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
const pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

const valRegF00G100 = {
  message: {
    feeRecipient: fromHexString("0x00"),
    gasLimit: 100,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};

const valRegF10G100 = {
  message: {
    feeRecipient: fromHexString("0x10"),
    gasLimit: 100,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};

const valRegF10G200 = {
  message: {
    feeRecipient: fromHexString("0x10"),
    gasLimit: 200,
    timestamp: Date.now(),
    pubkey: pubkeys[0],
  },
  signature: Buffer.alloc(96, 0),
};
