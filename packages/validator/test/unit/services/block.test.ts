import {Mocked, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, ForkName} from "@lodestar/params";
import {ProducedBlockSource, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {BlockProposingService} from "../../../src/services/block.js";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
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

    // vi.mock does not automock all objects in Bun runtime, so we have to explicitly spy on needed methods
    vi.spyOn(validatorStore, "votingPubkeys");
    vi.spyOn(validatorStore, "signRandao");
    vi.spyOn(validatorStore, "signBlock");
    vi.spyOn(validatorStore, "signBlockForEquivocation");
    vi.spyOn(validatorStore, "signExecutionPayloadEnvelope");
    vi.spyOn(validatorStore, "getBuilderSelectionParams");
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
    validatorStore.signBlock.mockImplementation(async (_, block) => ({
      message: block,
      signature: signedBlock.signature,
    }));
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
    validatorStore.signBlock.mockImplementation(async (_, block) => ({
      message: block,
      signature: signedBlock.signature,
    }));
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

    // Must have submitted the block received on signBlock()
    expect(api.beacon.publishBlindedBlockV2).toHaveBeenCalledOnce();
    expect(api.beacon.publishBlindedBlockV2.mock.calls[0]).toEqual([
      {signedBlindedBlock: signedBlock, broadcastValidation: routes.beacon.BroadcastValidation.consensus},
    ]);
  });

  it("Should split the network with a self-built canonical block and a builder-block minority", async () => {
    const slot = 1;
    const config = createChainForkConfig({
      ...mainnetConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    });
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
      broadcastValidation: routes.beacon.BroadcastValidation.gossip,
      blindedLocal: false,
      payloadLocal: true,
      adversarialEquivocateBlockProposal: true,
    });

    const builderBlock = ssz.gloas.BeaconBlock.defaultValue();
    builderBlock.slot = slot;
    builderBlock.body.signedExecutionPayloadBid.message.builderIndex = 42;
    const selfBuildBlock = ssz.gloas.BeaconBlock.clone(builderBlock);
    selfBuildBlock.body.signedExecutionPayloadBid.message.builderIndex = BUILDER_INDEX_SELF_BUILD;
    const {signature} = ssz.gloas.SignedBeaconBlock.defaultValue();

    validatorStore.signRandao.mockResolvedValue(builderBlock.body.randaoReveal);
    validatorStore.signBlock.mockImplementation(async (_pubkey, signableBlock) => ({
      message: signableBlock,
      signature,
    }));
    validatorStore.signBlockForEquivocation.mockImplementation(async (_pubkey, conflictingBlock) => ({
      message: conflictingBlock,
      signature,
    }));
    validatorStore.getBuilderSelectionParams.mockReturnValue({
      selection: routes.validator.BuilderSelection.MaxProfit,
      boostFactor: BigInt(100),
    });
    validatorStore.getGraffiti.mockReturnValue("deathstar");
    validatorStore.getFeeRecipient.mockReturnValue("0x00");

    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message = envelope;
    validatorStore.signExecutionPayloadEnvelope.mockResolvedValue(signedEnvelope);
    api.validator.getExecutionPayloadEnvelope.mockResolvedValue(
      mockApiResponse({data: envelope, meta: {version: ForkName.gloas}})
    );
    api.beacon.publishExecutionPayloadEnvelope.mockResolvedValue(mockApiResponse({}));

    api.validator.produceBlockV4
      .mockResolvedValueOnce(
        mockApiResponse({
          data: builderBlock,
          meta: {
            version: ForkName.gloas,
            executionPayloadValue: BigInt(1),
            consensusBlockValue: BigInt(0),
            executionPayloadIncluded: false,
          },
        })
      )
      .mockResolvedValueOnce(
        mockApiResponse({
          data: selfBuildBlock,
          meta: {
            version: ForkName.gloas,
            executionPayloadValue: BigInt(0),
            consensusBlockValue: BigInt(0),
            executionPayloadIncluded: false,
          },
        })
      );
    api.beacon.publishBlockV2.mockResolvedValue(mockApiResponse({}));
    api.lodestar.publishBlockEquivocation.mockResolvedValue(mockApiResponse({}));

    await blockService["createAndPublishBlockGloas"](pubkeys[0], slot);

    // Produced the builder block, then a self-built sibling on the same parent with ExecutionOnly selection
    expect(api.validator.produceBlockV4).toHaveBeenCalledTimes(2);
    expect(api.validator.produceBlockV4).toHaveBeenNthCalledWith(2, {
      slot,
      randaoReveal: builderBlock.body.randaoReveal,
      graffiti: "deathstar",
      feeRecipient: "0x00",
      includePayload: false,
      builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
      builderBoostFactor: BigInt(0),
    });

    // The equivocation goes through the single split route, not the normal flood publish
    expect(api.beacon.publishBlockV2).not.toHaveBeenCalled();
    expect(api.lodestar.publishBlockEquivocation).toHaveBeenCalledOnce();
    expect(validatorStore.signBlock).toHaveBeenCalledWith(pubkeys[0], selfBuildBlock, slot, loggerVc);

    // The self-built block is the canonical (majority) block, the builder block the minority, signed without
    // slashing protection, sized by builderPeersBps
    const [equivocationArgs] = api.lodestar.publishBlockEquivocation.mock.calls[0];
    expect(equivocationArgs.selfBuiltBlock.message).toEqual(selfBuildBlock);
    expect(equivocationArgs.builderBlock.message).toEqual(builderBlock);
    expect(equivocationArgs.builderPeersBps).toBe(4000);
    expect(validatorStore.signBlockForEquivocation).toHaveBeenCalledWith(pubkeys[0], builderBlock, slot, loggerVc);
    expect(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(equivocationArgs.selfBuiltBlock.message)).not.toEqual(
      config.getForkTypes(slot).BeaconBlock.hashTreeRoot(builderBlock)
    );

    // The canonical self-built block reveals its own execution payload envelope
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();

    // A self-build proposal does not equivocate: no sibling produced, normal flood publish, no split route
    api.validator.produceBlockV4.mockReset();
    api.beacon.publishBlockV2.mockClear();
    api.lodestar.publishBlockEquivocation.mockClear();
    validatorStore.signBlockForEquivocation.mockClear();
    api.beacon.publishExecutionPayloadEnvelope.mockClear();
    api.validator.produceBlockV4.mockResolvedValue(
      mockApiResponse({
        data: selfBuildBlock,
        meta: {
          version: ForkName.gloas,
          executionPayloadValue: BigInt(1),
          consensusBlockValue: BigInt(0),
          executionPayloadIncluded: false,
        },
      })
    );

    await blockService["createAndPublishBlockGloas"](pubkeys[0], slot);
    expect(api.validator.produceBlockV4).toHaveBeenCalledOnce();
    expect(api.beacon.publishBlockV2).toHaveBeenCalledOnce();
    expect(api.lodestar.publishBlockEquivocation).not.toHaveBeenCalled();
    expect(validatorStore.signBlockForEquivocation).not.toHaveBeenCalled();
    expect(api.beacon.publishExecutionPayloadEnvelope).toHaveBeenCalledOnce();
  });
});
