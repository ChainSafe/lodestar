import {Mocked, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {SecretKey} from "@lodestar/native/blst";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {ProducedBlockSource, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Metrics} from "../../../src/metrics.js";
import {BlockProposingService} from "../../../src/services/block.js";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiErrorResponse, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {MockedLogger, getMockedLogger, loggerVc} from "../../utils/logger.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/validatorStore.js");
vi.mock("../../../src/services/chainHeaderTracker.js");

describe("BlockDutiesService", () => {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class don't need parameters
  const validatorStore = vi.mocked(new ValidatorStore({}, {defaultConfig: {}}));
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createChainForkConfig(mainnetConfig);
  // @ts-expect-error - Mocked class don't need parameters
  const chainHeaderTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
    const secretKeys = Array.from({length: 2}, (_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());

    vi.spyOn(validatorStore, "votingPubkeys");
    vi.spyOn(validatorStore, "signRandao");
    vi.spyOn(validatorStore, "signBlock");
    vi.spyOn(validatorStore, "getBuilderSelectionParams");
    vi.spyOn(validatorStore, "getBuilderMinBid");
    vi.spyOn(validatorStore, "getResolvedBuilderEntries");
    vi.spyOn(validatorStore, "getGraffiti");
    vi.spyOn(validatorStore, "getFeeRecipient");
    vi.spyOn(validatorStore, "strictFeeRecipientCheck");

    validatorStore.votingPubkeys.mockReturnValue(pubkeys.map(toHexString));
  });
  afterEach(() => controller.abort());

  it("Should produce, sign, and publish a block", async () => {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({
        data: [{slot, validatorIndex: 0, pubkey: pubkeys[0]}],
        meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      })
    );

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, dutiesService, null, {
      broadcastValidation: routes.beacon.BroadcastValidation.consensus,
      blindedLocal: false,
      payloadLocal: false,
    });

    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.mockResolvedValue(signedBlock);
    validatorStore.getBuilderSelectionParams.mockReturnValue({
      selection: routes.validator.BuilderSelection.MaxProfit,
      boostFactor: BigInt(100),
    });
    validatorStore.getGraffiti.mockReturnValue("aaaa");
    validatorStore.getFeeRecipient.mockReturnValue("0x00");
    validatorStore.strictFeeRecipientCheck.mockReturnValue(false);

    api.validator.produceBlockV3.mockResolvedValue(
      mockApiResponse({
        data: {block: signedBlock.message},
        meta: {
          version: ForkName.bellatrix,
          executionPayloadValue: BigInt(1),
          consensusBlockValue: BigInt(1),
          executionPayloadBlinded: false,
          executionPayloadSource: ProducedBlockSource.engine,
        },
      })
    );
    api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));

    // Trigger block production for slot 1
    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);

    // Resolve all promises
    await sleep(20, controller.signal);

    expect(validatorStore.signBlock).toHaveBeenCalledOnce();
    expect(validatorStore.signBlock.mock.calls[0][1]).toBe(signedBlock.message);
    // Must have submitted the block received on signBlock()
    expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
    expect(api.beacon.publishBlockV2.mock.calls[0]).toEqual([
      {signedBlockContents: {signedBlock}, broadcastValidation: routes.beacon.BroadcastValidation.consensus},
    ]);

    // ProduceBlockV3 is called with all correct arguments
    expect(api.validator.produceBlockV3.mock.calls[0]).toEqual([
      {
        slot: 1,
        randaoReveal: signedBlock.message.body.randaoReveal,
        graffiti: "aaaa",
        skipRandaoVerification: false,
        feeRecipient: "0x00",
        builderSelection: routes.validator.BuilderSelection.MaxProfit,
        strictFeeRecipientCheck: false,
        blindedLocal: false,
        builderBoostFactor: BigInt(100),
      },
    ]);
  });

  it("Should produce, sign, and publish a blinded block", async () => {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({
        data: [{slot, validatorIndex: 0, pubkey: pubkeys[0]}],
        meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      })
    );

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, dutiesService, null, {
      broadcastValidation: routes.beacon.BroadcastValidation.consensus,
      blindedLocal: true,
      payloadLocal: false,
    });

    const signedBlock = ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue();
    validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.mockResolvedValue(signedBlock);
    api.validator.produceBlockV3.mockResolvedValue(
      mockApiResponse({
        data: signedBlock.message,
        meta: {
          version: ForkName.bellatrix,
          executionPayloadValue: BigInt(1),
          consensusBlockValue: BigInt(1),
          executionPayloadBlinded: true,
          executionPayloadSource: ProducedBlockSource.engine,
        },
      })
    );
    api.beacon.publishBlindedBlockV2.mockResolvedValue(mockApiResponse({}));

    // Trigger block production for slot 1
    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);

    // Resolve all promises
    await sleep(20, controller.signal);

    expect(validatorStore.signBlock).toHaveBeenCalledOnce();
    expect(validatorStore.signBlock.mock.calls[0][1]).toBe(signedBlock.message);
    // Must have submitted the block received on signBlock()
    expect(api.beacon.publishBlindedBlockV2).toHaveBeenCalledOnce();
    expect(api.beacon.publishBlindedBlockV2.mock.calls[0]).toEqual([
      {signedBlindedBlock: signedBlock, broadcastValidation: routes.beacon.BroadcastValidation.consensus},
    ]);
  });

  it.each([ForkName.gloas, ForkName.heze] as const)("checks fee recipient for a %s block", async (fork) => {
    const config = createChainForkConfig({
      ...mainnetConfig,
      GLOAS_FORK_EPOCH: 0,
      HEZE_FORK_EPOCH: fork === ForkName.heze ? 0 : Infinity,
    });
    const slot = 0;
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({
        data: [{slot, validatorIndex: 0, pubkey: pubkeys[0]}],
        meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      })
    );

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      config,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, dutiesService, null, {
      broadcastValidation: routes.beacon.BroadcastValidation.consensus,
      blindedLocal: false,
      payloadLocal: false,
    });

    const signedBlock = ssz[fork].SignedBeaconBlock.defaultValue();
    signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = 1;
    const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
    validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.mockResolvedValue(signedBlock);
    validatorStore.getBuilderSelectionParams.mockReturnValue({
      selection: routes.validator.BuilderSelection.ExecutionAlways,
      boostFactor: BigInt(0),
    });
    validatorStore.getBuilderMinBid.mockReturnValue(0n);
    validatorStore.getResolvedBuilderEntries.mockReturnValue([]);
    validatorStore.getGraffiti.mockReturnValue("aaaa");
    validatorStore.getFeeRecipient.mockReturnValue(feeRecipient);
    validatorStore.strictFeeRecipientCheck.mockReturnValue(true);

    api.validator.produceBlockV4.mockResolvedValue(
      mockApiResponse({
        data: signedBlock.message,
        meta: {
          version: fork,
          executionPayloadValue: BigInt(1),
          consensusBlockValue: BigInt(1),
          executionPayloadIncluded: false,
        },
      })
    );
    api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));

    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);
    await sleep(20, controller.signal);

    expect(validatorStore.signBlock).toHaveBeenCalledOnce();
    expect(validatorStore.signBlock.mock.calls[0][1]).toBe(signedBlock.message);
    expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
    expect(api.beacon.publishBlockV2.mock.calls[0][0]).toMatchObject({signedBlockContents: {signedBlock}});
    expect(api.validator.produceBlockV4).toHaveBeenCalledWith({
      slot: 1,
      randaoReveal: signedBlock.message.body.randaoReveal,
      graffiti: "aaaa",
      feeRecipient,
      strictFeeRecipientCheck: true,
      includePayload: true,
      builderConfig: {minBid: 0n, builderBoostFactor: 0n, builders: []},
    });
  });

  it.each([
    {builderIndex: 1, published: false},
    {builderIndex: BUILDER_INDEX_SELF_BUILD, published: true},
  ])(
    "Should not use builder bids when producing a Gloas block with executiononly builderIndex=$builderIndex",
    async ({builderIndex, published}) => {
      const gloasConfig = createChainForkConfig({...mainnetConfig, GLOAS_FORK_EPOCH: 0});
      api.validator.getProposerDuties.mockResolvedValue(
        mockApiResponse({
          data: [{slot: 0, validatorIndex: 0, pubkey: pubkeys[0]}],
          meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
        })
      );

      const clock = new ClockMock();
      const dutiesService = new BlockDutiesService(
        gloasConfig,
        loggerVc,
        api,
        clock,
        validatorStore,
        chainHeaderTracker,
        null
      );
      const blockService = new BlockProposingService(
        gloasConfig,
        loggerVc,
        api,
        clock,
        validatorStore,
        dutiesService,
        null,
        {
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
          blindedLocal: false,
          payloadLocal: false,
        }
      );

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = builderIndex;
      const feeRecipient = "0xcccccccccccccccccccccccccccccccccccccccc";
      validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
      validatorStore.signBlock.mockResolvedValue(signedBlock);
      validatorStore.getBuilderSelectionParams.mockReturnValue({
        selection: routes.validator.BuilderSelection.ExecutionOnly,
        boostFactor: BigInt(0),
      });
      validatorStore.getBuilderMinBid.mockReturnValue(0n);
      validatorStore.getGraffiti.mockReturnValue("aaaa");
      validatorStore.getFeeRecipient.mockReturnValue(feeRecipient);
      validatorStore.strictFeeRecipientCheck.mockReturnValue(true);

      api.validator.produceBlockV4.mockResolvedValue(
        mockApiResponse({
          data: signedBlock.message,
          meta: {
            version: ForkName.gloas,
            executionPayloadValue: BigInt(1),
            consensusBlockValue: BigInt(1),
            executionPayloadIncluded: false,
          },
        })
      );

      api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));

      const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
      notifyBlockProductionFn(1, [pubkeys[0]]);
      await sleep(20, controller.signal);

      expect(validatorStore.getResolvedBuilderEntries).not.toHaveBeenCalled();
      expect(api.validator.produceBlockV4).toHaveBeenCalledWith({
        slot: 1,
        randaoReveal: signedBlock.message.body.randaoReveal,
        graffiti: "aaaa",
        feeRecipient,
        strictFeeRecipientCheck: true,
        includePayload: true,
        builderConfig: {minBid: 2n ** 64n - 1n, builderBoostFactor: 0n, builders: []},
      });
      expect(validatorStore.signBlock).toHaveBeenCalledTimes(published ? 1 : 0);
      expect(api.beacon.publishBlockV2).toHaveBeenCalledTimes(published ? 1 : 0);
    }
  );

  it.each([
    {executionPayloadIncluded: true, revealed: true},
    {executionPayloadIncluded: false, revealed: false},
  ])(
    "Should publish the envelope of a self-built Gloas block only if the payload is included executionPayloadIncluded=$executionPayloadIncluded",
    async ({executionPayloadIncluded, revealed}) => {
      const gloasConfig = createChainForkConfig({...mainnetConfig, GLOAS_FORK_EPOCH: 0});
      api.validator.getProposerDuties.mockResolvedValue(
        mockApiResponse({
          data: [{slot: 0, validatorIndex: 0, pubkey: pubkeys[0]}],
          meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
        })
      );

      const clock = new ClockMock();
      const dutiesService = new BlockDutiesService(
        gloasConfig,
        loggerVc,
        api,
        clock,
        validatorStore,
        chainHeaderTracker,
        null
      );
      const blockService = new BlockProposingService(
        gloasConfig,
        loggerVc,
        api,
        clock,
        validatorStore,
        dutiesService,
        null,
        {
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
          blindedLocal: false,
          payloadLocal: !executionPayloadIncluded,
        }
      );

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
      const contents = {
        block: signedBlock.message,
        executionPayloadEnvelope: ssz.gloas.ExecutionPayloadEnvelope.defaultValue(),
        kzgProofs: [],
        blobs: [],
      };
      validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
      validatorStore.signBlock.mockResolvedValue(signedBlock);
      validatorStore.getBuilderSelectionParams.mockReturnValue({
        selection: routes.validator.BuilderSelection.ExecutionOnly,
        boostFactor: BigInt(0),
      });
      validatorStore.getBuilderMinBid.mockReturnValue(0n);
      validatorStore.getGraffiti.mockReturnValue("aaaa");
      validatorStore.getFeeRecipient.mockReturnValue("0xcccccccccccccccccccccccccccccccccccccccc");
      validatorStore.strictFeeRecipientCheck.mockReturnValue(true);

      api.validator.produceBlockV4.mockResolvedValue(
        mockApiResponse({
          data: executionPayloadIncluded ? contents : signedBlock.message,
          meta: {
            version: ForkName.gloas,
            executionPayloadValue: BigInt(1),
            consensusBlockValue: BigInt(1),
            executionPayloadIncluded,
          },
        })
      );
      api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));
      api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));

      const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
      notifyBlockProductionFn(1, [pubkeys[0]]);
      await sleep(20, controller.signal);

      expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
      if (revealed) {
        expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledExactlyOnceWith({
          executionPayloadEnvelopeContents: {
            executionPayloadEnvelope: contents.executionPayloadEnvelope,
            kzgProofs: contents.kzgProofs,
            blobs: contents.blobs,
          },
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
        });
      } else {
        expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      }
    }
  );

  describe("fallback publish of the envelope of a self-built Gloas block", () => {
    const slot = 1;
    let logger: MockedLogger;

    function setup(): {clock: ClockMock; metrics: ReturnType<typeof getMetricsStub>; propose: () => Promise<void>} {
      const gloasConfig = createChainForkConfig({...mainnetConfig, GLOAS_FORK_EPOCH: 0});
      api.validator.getProposerDuties.mockResolvedValue(
        mockApiResponse({
          data: [{slot: 0, validatorIndex: 0, pubkey: pubkeys[0]}],
          meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
        })
      );

      const clock = new ClockMock();
      const metrics = getMetricsStub();
      const dutiesService = new BlockDutiesService(
        gloasConfig,
        {...logger, isSyncing: vi.fn()},
        api,
        clock,
        validatorStore,
        chainHeaderTracker,
        null
      );
      const blockService = new BlockProposingService(
        gloasConfig,
        {...logger, isSyncing: vi.fn()},
        api,
        clock,
        validatorStore,
        dutiesService,
        metrics as unknown as Metrics,
        {
          broadcastValidation: routes.beacon.BroadcastValidation.consensus,
          blindedLocal: false,
          payloadLocal: false,
        }
      );

      const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
      signedBlock.message.body.signedExecutionPayloadBid.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
      validatorStore.signRandao.mockResolvedValue(signedBlock.message.body.randaoReveal);
      validatorStore.signBlock.mockResolvedValue(signedBlock);
      validatorStore.getBuilderSelectionParams.mockReturnValue({
        selection: routes.validator.BuilderSelection.ExecutionOnly,
        boostFactor: BigInt(0),
      });
      validatorStore.getBuilderMinBid.mockReturnValue(0n);
      validatorStore.getGraffiti.mockReturnValue("aaaa");
      validatorStore.getFeeRecipient.mockReturnValue("0xcccccccccccccccccccccccccccccccccccccccc");
      validatorStore.strictFeeRecipientCheck.mockReturnValue(true);

      api.validator.produceBlockV4.mockResolvedValue(
        mockApiResponse({
          data: {
            block: signedBlock.message,
            executionPayloadEnvelope: ssz.gloas.ExecutionPayloadEnvelope.defaultValue(),
            kzgProofs: [],
            blobs: [],
          },
          meta: {
            version: ForkName.gloas,
            executionPayloadValue: BigInt(1),
            consensusBlockValue: BigInt(1),
            executionPayloadIncluded: true,
          },
        })
      );
      api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));
      api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));

      return {
        clock,
        metrics,
        propose: async () => {
          blockService["dutiesService"]["notifyBlockProductionFn"](slot, [pubkeys[0]]);
          await sleep(20, controller.signal);
        },
      };
    }

    function getMetricsStub() {
      return {
        proposerStepCallProduceBlock: {observe: vi.fn()},
        proposerStepCallPublishBlock: {observe: vi.fn()},
        blocksProduced: {inc: vi.fn()},
        blocksPublished: {inc: vi.fn()},
        blockProposingErrors: {inc: vi.fn()},
        payloadEnvelopeProposingErrors: {inc: vi.fn()},
      };
    }

    function loggedMessages(method: "error" | "warn"): string[] {
      return logger[method].mock.calls.map(([message]) => message);
    }

    beforeEach(() => {
      logger = getMockedLogger();
    });

    it("Should publish the envelope of a block in its slot", async () => {
      const {clock, metrics, propose} = setup();
      clock.getCurrentSlot = () => slot;

      await propose();

      expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
      expect(metrics.payloadEnvelopeProposingErrors.inc).not.toHaveBeenCalled();
    });

    it("Should not publish the envelope of a block whose slot has passed", async () => {
      const {clock, metrics, propose} = setup();
      // The block was published late
      clock.getCurrentSlot = () => slot + 1;

      await propose();

      expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
      expect(api.beacon.publishExecutionPayloadEnvelope).not.toHaveBeenCalled();
      expect(loggedMessages("warn")).toContain(
        "Block is from a past slot, not publishing its execution payload envelope"
      );
      // Neither the proposal nor the envelope publish failed
      expect(loggedMessages("error")).toEqual([]);
      expect(metrics.blocksPublished.inc).toHaveBeenCalledOnce();
      expect(metrics.blockProposingErrors.inc).not.toHaveBeenCalled();
      expect(metrics.payloadEnvelopeProposingErrors.inc).not.toHaveBeenCalled();
    });

    it.each([
      {
        failure: "request error",
        mockFailure: () => api.beacon.publishExecutionPayloadEnvelope.mockRejectedValue(new Error("fetch failed")),
      },
      {
        failure: "error response",
        mockFailure: () =>
          api.beacon.publishExecutionPayloadEnvelope.mockReturnValue(
            mockApiErrorResponse(500, {code: 500, message: "Self-built execution payload not fully published"})
          ),
      },
    ])(
      "Should not report a failed envelope publish as a failed block proposal failure=$failure",
      async ({mockFailure}) => {
        const {clock, metrics, propose} = setup();
        clock.getCurrentSlot = () => slot;
        mockFailure();

        await propose();

        expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
        expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
        expect(loggedMessages("error")).toEqual(["Error publishing execution payload envelope"]);
        expect(metrics.blocksPublished.inc).toHaveBeenCalledOnce();
        expect(metrics.blockProposingErrors.inc).not.toHaveBeenCalled();
        expect(metrics.payloadEnvelopeProposingErrors.inc).toHaveBeenCalledExactlyOnceWith({error: "publish"});
      }
    );
  });
});
