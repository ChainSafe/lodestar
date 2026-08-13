import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {bellatrix} from "@lodestar/types";
import {ValidatorProposerConfig, ValidatorStore} from "../../src/services/validatorStore.js";
import {getApiClientStub} from "../utils/apiStub.js";
import {getMockedLogger} from "../utils/logger.js";
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
    expect(validatorStore.getGasLimit(toHexString(pubkeys[0]), 0)).toBe(
      valProposerConfig.proposerConfig[toHexString(pubkeys[0])].builder?.gasLimit
    );

    // default values
    expect(validatorStore.getGraffiti(toHexString(pubkeys[1]))).toBe(valProposerConfig.defaultConfig.graffiti);
    expect(validatorStore.getFeeRecipient(toHexString(pubkeys[1]))).toBe(valProposerConfig.defaultConfig.feeRecipient);
    expect(validatorStore.strictFeeRecipientCheck(toHexString(pubkeys[1]))).toBe(
      valProposerConfig.defaultConfig.strictFeeRecipientCheck
    );
    expect(validatorStore.getGasLimit(toHexString(pubkeys[1]), 0)).toBe(
      valProposerConfig.defaultConfig.builder?.gasLimit
    );
  });

  it("getBuilderSelectionParams resolves fork-aware defaults and aliases", async () => {
    const preGloasSlot = 0;
    // pubkeys[0] explicitly configured executiononly, honored pre-gloas
    expect(validatorStore.getBuilderSelectionParams(toHexString(pubkeys[0]), preGloasSlot)).toEqual({
      selection: routes.validator.BuilderSelection.ExecutionOnly,
      boostFactor: BigInt(0),
    });
    // pubkeys[1] has no selection configured, pre-gloas default is executiononly
    expect(validatorStore.getBuilderSelectionParams(toHexString(pubkeys[1]), preGloasSlot)).toEqual({
      selection: routes.validator.BuilderSelection.ExecutionOnly,
      boostFactor: BigInt(0),
    });

    // Post-gloas the unconfigured default becomes `default` (as if `--builder` was set)
    const gloasStore = await initValidatorStore(
      secretKeys,
      api,
      {
        ...chainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      },
      valProposerConfig
    );
    const gloasSlot = 0;
    expect(gloasStore.getBuilderSelectionParams(toHexString(pubkeys[1]), gloasSlot)).toEqual({
      selection: routes.validator.BuilderSelection.Default,
      boostFactor: BigInt(90),
    });
    // Post-gloas executiononly is a backwards-compatible alias for executionalways
    expect(gloasStore.getBuilderSelectionParams(toHexString(pubkeys[0]), gloasSlot)).toEqual({
      selection: routes.validator.BuilderSelection.ExecutionAlways,
      boostFactor: BigInt(0),
    });
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

  it("resolves an unconfigured gas limit from the schedule per duty", async () => {
    const scheduleStore = await initValidatorStore(
      secretKeys,
      api,
      {
        ...chainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 2,
        GAS_LIMIT_SCHEDULE: [
          {EPOCH: 2, GAS_LIMIT: 75_000_000},
          {EPOCH: 3, GAS_LIMIT: 90_000_000},
        ],
      },
      {defaultConfig: {builder: {}}, proposerConfig: {}}
    );
    const pubkey = toHexString(pubkeys[0]);

    expect(scheduleStore.getGasLimit(pubkey, 2 * SLOTS_PER_EPOCH - 1)).toBe(60_000_000);
    expect(scheduleStore.getGasLimit(pubkey, 2 * SLOTS_PER_EPOCH)).toBe(75_000_000);
    expect(scheduleStore.getGasLimit(pubkey, 3 * SLOTS_PER_EPOCH)).toBe(90_000_000);
  });

  it("honors and warns about a configured gas limit above the scheduled recommendation", async () => {
    const configuredGasLimit = 90_000_000;
    const recommendedGasLimit = 75_000_000;
    const scheduleStore = await initValidatorStore(
      secretKeys,
      api,
      {
        ...chainConfig,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
        GAS_LIMIT_SCHEDULE: [{EPOCH: 0, GAS_LIMIT: recommendedGasLimit}],
      },
      {defaultConfig: {builder: {gasLimit: configuredGasLimit}}, proposerConfig: {}}
    );
    const pubkey = toHexString(pubkeys[0]);
    const logger = {...getMockedLogger(), isSyncing: vi.fn()};

    expect(scheduleStore.getGasLimit(pubkey, 0, logger)).toBe(configuredGasLimit);
    expect(logger.warn).toHaveBeenCalledWith("Configured gas limit exceeds recommended maximum", {
      pubkey,
      slot: 0,
      configuredGasLimit,
      recommendedGasLimit,
    });
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
