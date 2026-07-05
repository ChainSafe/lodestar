import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {DOMAIN_REQUEST_AUTH} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {bellatrix, ssz} from "@lodestar/types";
import {ValidatorProposerConfig, ValidatorStore} from "../../src/services/validatorStore.js";
import {getApiClientStub} from "../utils/apiStub.js";
import {initValidatorStore} from "../utils/validatorStore.js";

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
            gasLimit: 45000000,
            selection: routes.validator.BuilderSelection.ExecutionOnly,
            maxExecutionPayment: BigInt(1),
            builders: {
              "https://builder.example.com": {maxExecutionPayment: BigInt(100)},
              "https://other-builder.example.com": {},
            },
          },
        },
      },
      defaultConfig: {
        graffiti: "default graffiti",
        strictFeeRecipientCheck: false,
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
        builder: {
          gasLimit: 35000000,
          maxExecutionPayment: BigInt(5),
          builders: {
            "https://default-builder.example.com": {},
          },
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
      vi.clearAllMocks();
      vi.spyOn(validatorStore, "signValidatorRegistration").mockResolvedValue(valReg);

      const val1 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val1)).toEqual(JSON.stringify(valReg));
      expect(validatorStore.signValidatorRegistration).toHaveBeenCalledOnce();
      const val2 = await validatorStore.getValidatorRegistration(pubkeys[0], {feeRecipient, gasLimit}, slot++);
      expect(JSON.stringify(val2)).toEqual(JSON.stringify(valReg));
      expect(validatorStore.signValidatorRegistration).toHaveBeenCalledOnce();
    }
  });

  it("Should resolve registered builders with per-builder preferences", () => {
    // per-builder value wins, missing value falls back to the per-key maxExecutionPayment
    expect(validatorStore.getRegisteredBuilders(toHexString(pubkeys[0]))).toEqual([
      {url: "https://builder.example.com", maxExecutionPayment: BigInt(100)},
      {url: "https://other-builder.example.com", maxExecutionPayment: BigInt(1)},
    ]);

    // default values
    expect(validatorStore.getRegisteredBuilders(toHexString(pubkeys[1]))).toEqual([
      {url: "https://default-builder.example.com", maxExecutionPayment: BigInt(5)},
    ]);
  });

  it("Should sign request auth with fork-independent domain", async () => {
    const builderUrl = "https://builder.example.com";
    const proposalSlot = 10;

    const signedRequestAuth = await validatorStore.signRequestAuth(pubkeys[0], builderUrl, proposalSlot);

    expect(Buffer.from(signedRequestAuth.message.data).toString("utf8")).toBe(builderUrl);
    expect(signedRequestAuth.message.slot).toBe(proposalSlot);

    const domain = computeDomain(DOMAIN_REQUEST_AUTH, chainConfig.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.gloas.RequestAuthV1, signedRequestAuth.message, domain);
    expect(toHexString(signedRequestAuth.signature)).toBe(toHexString(secretKeys[0].sign(signingRoot).toBytes()));
  });

  it("Should cache request auths and prune auths for past proposal slots", async () => {
    const builderUrl = "https://builder.example.com";
    vi.spyOn(validatorStore, "signRequestAuth");

    const auth1 = await validatorStore.getRequestAuth(pubkeys[0], builderUrl, 10, 5);
    const auth2 = await validatorStore.getRequestAuth(pubkeys[0], builderUrl, 10, 5);
    expect(auth2).toBe(auth1);
    expect(validatorStore.signRequestAuth).toHaveBeenCalledOnce();

    // Signing for a later proposal slot prunes the auth for the now-past slot 10
    await validatorStore.getRequestAuth(pubkeys[0], builderUrl, 20, 15);
    expect(validatorStore.signRequestAuth).toHaveBeenCalledTimes(2);

    await validatorStore.getRequestAuth(pubkeys[0], builderUrl, 10, 15);
    expect(validatorStore.signRequestAuth).toHaveBeenCalledTimes(3);
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
