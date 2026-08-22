import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {DOMAIN_REQUEST_AUTH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ZERO_HASH, computeDomain, computeSigningRoot} from "@lodestar/state-transition";
import {bellatrix, ssz} from "@lodestar/types";
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

    // A standard per-key builder config directly sets the Gloas boost, regardless of legacy selection aliases
    gloasStore.setBuilderConfig(toHexString(pubkeys[0]), {builderBoostFactor: 120n});
    expect(gloasStore.getBuilderSelectionParams(toHexString(pubkeys[0]), gloasSlot)).toEqual({
      selection: routes.validator.BuilderSelection.MaxProfit,
      boostFactor: 120n,
    });
    expect(gloasStore.getBuilderConfig(toHexString(pubkeys[0])).builderBoostFactor).toBe(120n);

    // GET resolves an unconfigured key to the effective post-Gloas default
    expect(gloasStore.getBuilderConfig(toHexString(pubkeys[1])).builderBoostFactor).toBe(90n);
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

  it("Should sign request auth with fork-independent domain", async () => {
    const data = Buffer.from("https://builder.example.com", "utf8");
    const proposalSlot = 10;

    const signedRequestAuth = await validatorStore.signRequestAuth(pubkeys[0], data, proposalSlot);

    expect(toHexString(signedRequestAuth.message.data)).toBe(toHexString(data));
    expect(signedRequestAuth.message.slot).toBe(proposalSlot);

    const domain = computeDomain(DOMAIN_REQUEST_AUTH, chainConfig.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.gloas.RequestAuth, signedRequestAuth.message, domain);
    expect(toHexString(signedRequestAuth.signature)).toBe(toHexString(secretKeys[0].sign(signingRoot).toBytes()));

    // Signing root must bind both the auth data and the proposal slot
    const otherData = computeSigningRoot(
      ssz.gloas.RequestAuth,
      {data: Buffer.from("other"), slot: proposalSlot},
      domain
    );
    const otherSlot = computeSigningRoot(ssz.gloas.RequestAuth, {data, slot: proposalSlot + 1}, domain);
    expect(toHexString(otherData)).not.toBe(toHexString(signingRoot));
    expect(toHexString(otherSlot)).not.toBe(toHexString(signingRoot));
  });

  it("Should reject request auth data with invalid length", async () => {
    await expect(validatorStore.signRequestAuth(pubkeys[0], new Uint8Array(0), 10)).rejects.toThrow();
    await expect(validatorStore.signRequestAuth(pubkeys[0], new Uint8Array(4097), 10)).rejects.toThrow();
  });

  it("Should resolve builder entries against key and validator client defaults", () => {
    const pubkey = toHexString(pubkeys[0]);
    const builderUrl = "https://builder.example.com";

    // No per-key config resolves to the validator client's builders (none configured)
    expect(validatorStore.getResolvedBuilderEntries(pubkey)).toEqual([]);

    validatorStore.setBuilderConfig(pubkey, {
      minBid: 10n,
      builders: [
        {url: builderUrl, maxExecutionPayment: 5n},
        {url: builderUrl, authData: "0x1234", minBid: 20n, builderBoostFactor: 120n},
      ],
    });

    const entries = validatorStore.getResolvedBuilderEntries(pubkey);
    expect(entries).toHaveLength(2);
    // Omitted auth data derives from the entry url, omitted min bid takes the key default
    expect(Buffer.from(entries[0].authData).toString("utf8")).toBe(builderUrl);
    expect(entries[0].minBid).toBe(10n);
    expect(entries[0].maxExecutionPayment).toBe(5n);
    // Per-entry values win over the key defaults
    expect(toHexString(entries[1].authData)).toBe("0x1234");
    expect(entries[1].minBid).toBe(20n);
    expect(entries[1].builderBoostFactor).toBe(120n);

    // GET returns the configuration fully resolved
    const config = validatorStore.getBuilderConfig(pubkey);
    expect(config.minBid).toBe(10n);
    expect(config.builders?.[0].authData).toBeDefined();
    expect(config.builders?.[0].builderPubkeys).toEqual([]);

    // Duplicate (url, auth data) entries are rejected, an omitted auth data compares as derived
    expect(() =>
      validatorStore.setBuilderConfig(pubkey, {
        builders: [{url: builderUrl}, {url: builderUrl}],
      })
    ).toThrow();

    // Delete reverts the key to the validator client's own configuration
    validatorStore.deleteBuilderConfig(pubkey);
    expect(validatorStore.getResolvedBuilderEntries(pubkey)).toEqual([]);
    expect(validatorStore.getBuilderMinBid(pubkey)).toBe(0n);
  });

  it("Should resolve the validator client's default builder entries with key defaults applied", async () => {
    const pubkey = toHexString(pubkeys[0]);
    const builderUrl = "https://builder.example.com";
    const store = await initValidatorStore(secretKeys, api, chainConfig, {
      proposerConfig: {
        [pubkey]: {
          builder: {minBid: 30n},
        },
      },
      defaultConfig: {
        builder: {
          builders: [
            {url: builderUrl, builderBoostFactor: 150n},
            {url: builderUrl, authData: "0x0123"},
          ],
        },
      },
    });

    // A key without its own builders follows the default entries, its key defaults still apply
    const entries = store.getResolvedBuilderEntries(pubkey);
    expect(entries).toHaveLength(2);
    expect(Buffer.from(entries[0].authData).toString("utf8")).toBe(builderUrl);
    expect(entries[0].minBid).toBe(30n);
    expect(entries[0].builderBoostFactor).toBe(150n);
    // Explicit auth data (e.g. from a --builder.urls fragment) is used as is
    expect(toHexString(entries[1].authData)).toBe("0x0123");
    expect(entries[1].minBid).toBe(30n);

    // Per-key builders replace the default entries
    store.setBuilderConfig(pubkey, {builders: []});
    expect(store.getResolvedBuilderEntries(pubkey)).toEqual([]);
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
