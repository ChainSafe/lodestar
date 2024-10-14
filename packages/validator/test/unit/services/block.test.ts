import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {sleep} from "@lodestar/utils";
import {ssz, ProducedBlockSource} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {BlockProposingService} from "../../../src/services/block.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/validatorStore.js");

describe("BlockDutiesService", () => {
  const api = getApiClientStub();
  // @ts-expect-error - Mocked class don't need parameters
  const validatorStore = vi.mocked(new ValidatorStore());
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createChainForkConfig(mainnetConfig);

  beforeAll(() => {
    const secretKeys = Array.from({length: 2}, (_, i) => SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.mockReturnValue(pubkeys.map(toHexString));
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
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
    // use produceBlockV3
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, null, {
      useProduceBlockV3: true,
      broadcastValidation: routes.beacon.BroadcastValidation.consensus,
      blindedLocal: false,
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
        data: signedBlock.message,
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
      {signedBlockOrContents: signedBlock, broadcastValidation: routes.beacon.BroadcastValidation.consensus},
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
    // use produceBlockV3
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, null, {
      useProduceBlockV3: true,
      broadcastValidation: routes.beacon.BroadcastValidation.consensus,
      blindedLocal: true,
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
});
