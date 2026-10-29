import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray, Type} from "@chainsafe/ssz";
import {ApiError} from "@lodestar/api/server";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipValidationResult, accept, fromResult} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {BeaconEngineMode} from "../../../../src/chain/beaconEngine/options.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {GossipAction, GossipActionError, GossipErrorCode} from "../../../../src/chain/errors/gossipValidation.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

const engineModes = [BeaconEngineMode.MainThread, BeaconEngineMode.Worker];

function validationCase<T extends object, R>(
  type: Type<T>,
  result: R,
  invokeCore: (core: BeaconEngineCore, bytes: Uint8Array) => Promise<GossipValidationResult<R>>,
  invokeFacade: (facade: BeaconEngine, bytes: Uint8Array, value: T) => Promise<GossipValidationResult<R>>,
  stubObject: (core: BeaconEngineCore, validate: (value: T) => Promise<GossipValidationResult<R>>) => void
) {
  return (core: BeaconEngineCore) => {
    const value = type.defaultValue();
    const bytes = type.serialize(value);
    const response = accept(result);
    const validate = vi.fn<(value: T) => Promise<GossipValidationResult<R>>>().mockResolvedValue(response);
    stubObject(core, validate);
    return {
      value,
      bytes,
      response,
      validate,
      serialize: vi.spyOn(type, "serialize"),
      deserialize: vi.spyOn(type, "deserialize"),
      invokeCore: (input = bytes) => invokeCore(core, input),
      invokeFacade: (facade: BeaconEngine, input = bytes) => invokeFacade(facade, input, value),
    };
  };
}

describe("BeaconEngineCore API bytes", () => {
  let core: BeaconEngineCore;
  let cache: SerializedCache;

  beforeEach(() => {
    core = getMockedBeaconChain().beaconEngine;
    cache = new SerializedCache();
    for (const method of [
      "validateApiSyncCommitteeBytes",
      "validateApiSyncCommitteeContributionAndProofBytes",
      "validateApiPayloadAttestationMessageBytes",
      "validateApiAggregateAndProofBytes",
      "validateApiExecutionPayloadEnvelopeBytes",
      "validateApiExecutionPayloadBidBytes",
      "verifyAndObserveBlockProposerBytes",
      "verifyEnvelopeForPublishBytes",
    ] as const) {
      Object.defineProperty(core, method, {value: BeaconEngineCore.prototype[method], configurable: true});
    }
    for (const name of ["blockSerializedCache", "serializedCache"]) {
      Object.defineProperty(core, name, {
        get: () => {
          throw Error(`API validation must not access ${name}`);
        },
      });
    }
  });

  afterEach(() => vi.restoreAllMocks());

  function facade(beaconEngineMode?: BeaconEngineMode): BeaconEngine {
    return new BeaconEngine({
      core,
      config: core.config,
      clock: core.clock,
      emitter: new ChainEventEmitter(),
      serializedCache: cache,
      ...(beaconEngineMode === BeaconEngineMode.Worker ? {coreEmitter: core.emitter} : {}),
    });
  }

  it("uses the object method with a main-thread core", async () => {
    const value = ssz.altair.SyncCommitteeMessage.defaultValue();
    const bytes = ssz.altair.SyncCommitteeMessage.serialize(value);
    const validate = vi.spyOn(core, "validateApiSyncCommittee").mockResolvedValue(accept({subnets: [0]}));
    const deserialize = vi.spyOn(ssz.altair.SyncCommitteeMessage, "deserialize");

    await facade().validateApiSyncCommittee(bytes, value);

    expect(validate.mock.calls[0][0]).toBe(value);
    expect(deserialize).not.toHaveBeenCalled();
  });

  const cases = [
    {
      name: "sync committee message",
      create: validationCase(
        ssz.altair.SyncCommitteeMessage,
        {subnets: [0]},
        (core, bytes) => core.validateApiSyncCommitteeBytes(bytes),
        (facade, bytes, value) => facade.validateApiSyncCommittee(bytes, value),
        (core, validate) => vi.spyOn(core, "validateApiSyncCommittee").mockImplementation(validate)
      ),
    },
    {
      name: "sync committee contribution",
      create: validationCase(
        ssz.altair.SignedContributionAndProof,
        undefined,
        (core, bytes) => core.validateApiSyncCommitteeContributionAndProofBytes(bytes),
        (facade, bytes, value) => facade.validateApiSyncCommitteeContributionAndProof(bytes, value),
        (core, validate) => vi.spyOn(core, "validateApiSyncCommitteeContributionAndProof").mockImplementation(validate)
      ),
    },
    {
      name: "payload attestation message",
      create: validationCase(
        ssz.gloas.PayloadAttestationMessage,
        undefined,
        (core, bytes) => core.validateApiPayloadAttestationMessageBytes(bytes),
        (facade, bytes, value) => facade.validateApiPayloadAttestationMessage(bytes, value),
        (core, validate) => vi.spyOn(core, "validateApiPayloadAttestationMessage").mockImplementation(validate)
      ),
    },
    ...[ForkName.phase0, ForkName.electra].map((fork) => ({
      name: `${fork} aggregate`,
      create: validationCase(
        sszTypesFor(fork).SignedAggregateAndProof,
        {indexedAttestation: sszTypesFor(fork).IndexedAttestation.defaultValue()},
        (core, bytes) => core.validateApiAggregateAndProofBytes(bytes, fork),
        (facade, bytes, value) => facade.validateApiAggregateAndProof(bytes, fork, value),
        (core, validate) =>
          vi.spyOn(core, "validateApiAggregateAndProof").mockImplementation((receivedFork, value) => {
            expect(receivedFork).toBe(fork);
            return validate(value);
          })
      ),
    })),
    {
      name: "execution payload envelope",
      create: validationCase(
        ssz.gloas.SignedExecutionPayloadEnvelope,
        undefined,
        (core, bytes) => core.validateApiExecutionPayloadEnvelopeBytes(bytes, 12),
        (facade, bytes, value) => facade.validateApiExecutionPayloadEnvelope(bytes, value, 12),
        (core, validate) =>
          vi.spyOn(core, "validateApiExecutionPayloadEnvelope").mockImplementation((value, seenTimestampSec) => {
            expect(seenTimestampSec).toBe(12);
            return validate(value);
          })
      ),
    },
    {
      name: "execution payload bid",
      create: validationCase(
        ssz.gloas.SignedExecutionPayloadBid,
        undefined,
        (core, bytes) => core.validateApiExecutionPayloadBidBytes(bytes, ForkName.gloas, 0),
        (facade, bytes, value) => facade.validateApiExecutionPayloadBid(bytes, value),
        (core, validate) => vi.spyOn(core, "validateApiExecutionPayloadBid").mockImplementation(validate)
      ),
    },
  ];

  describe.each(cases)("$name", ({create}) => {
    it.each(engineModes)("uses objects or bytes with beaconEngineMode=%s", async (beaconEngineMode) => {
      const test = create(core);
      const originalBytes = Uint8Array.from(test.bytes);
      expect(await test.invokeFacade(facade(beaconEngineMode))).toBe(test.response);
      expect(test.validate).toHaveBeenCalledOnce();
      expect(test.validate.mock.calls[0][0]).toEqual(test.value);
      expect(test.validate.mock.calls[0][0] === test.value).toBe(beaconEngineMode === BeaconEngineMode.MainThread);
      expect(test.deserialize).toHaveBeenCalledTimes(beaconEngineMode === BeaconEngineMode.Worker ? 1 : 0);
      expect(test.serialize).not.toHaveBeenCalled();
      expect(test.bytes).toEqual(originalBytes);
    });

    it("rejects malformed SSZ before validation", async () => {
      const test = create(core);
      expect(await test.invokeCore(new Uint8Array())).toMatchObject({
        err: {status: "reject", code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE},
      });
      expect(test.validate).not.toHaveBeenCalled();
    });

    it.each([GossipAction.IGNORE, GossipAction.REJECT])("preserves %s results", async (action) => {
      const test = create(core);
      const error = new GossipActionError(action, {code: "TEST_VERDICT"});
      const response = fromResult<never>({err: error});
      test.validate.mockResolvedValue(response);
      expect(await test.invokeCore()).toBe(response);
    });

    it("preserves unexpected API failures", async () => {
      const test = create(core);
      const error = new Error("API validation failed");
      test.validate.mockRejectedValue(error);
      await expect(test.invokeCore()).rejects.toBe(error);
    });
  });

  describe.each([ForkName.phase0, ForkName.electra, ForkName.gloas])("%s proposer verification", (fork) => {
    it.each(engineModes)("uses objects or bytes with beaconEngineMode=%s", async (beaconEngineMode) => {
      Object.defineProperty(core, "config", {value: createBeaconConfig(getConfig(fork), Buffer.alloc(32))});
      const type = sszTypesFor(fork).SignedBeaconBlock;
      const block = type.defaultValue();
      if (fork === ForkName.electra) {
        const attestation = ssz.electra.Attestation.defaultValue();
        attestation.aggregationBits = BitArray.fromSingleBit(9, 8);
        block.message.body.attestations.push(attestation);
      }
      const bytes = type.serialize(block);
      const originalBytes = Uint8Array.from(bytes);
      const deserialize = vi.spyOn(type, "deserialize");
      const validate = vi.spyOn(core, "verifyAndObserveBlockProposer").mockResolvedValue(undefined);
      await facade(beaconEngineMode).verifyAndObserveBlockProposer(bytes, block, "0x01");
      expect(validate).toHaveBeenCalledExactlyOnceWith(block, "0x01");
      expect(validate.mock.calls[0][0] === block).toBe(beaconEngineMode === BeaconEngineMode.MainThread);
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineMode === BeaconEngineMode.Worker ? 1 : 0);
      expect(bytes).toEqual(originalBytes);
    });
  });

  it("rejects truncated block SSZ before proposer verification", async () => {
    const validate = vi.spyOn(core, "verifyAndObserveBlockProposer");
    await expect(core.verifyAndObserveBlockProposerBytes(new Uint8Array(), "0x01")).rejects.toMatchObject({
      type: {code: "INVALID_BLOCK_SSZ"},
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("rejects malformed block bodies after reading the slot", async () => {
    const type = core.config.getForkTypes(0).SignedBeaconBlock;
    const bytes = type.serialize(type.defaultValue()).slice(0, -1);
    const validate = vi.spyOn(core, "verifyAndObserveBlockProposer");
    await expect(core.verifyAndObserveBlockProposerBytes(bytes, "0x01")).rejects.toMatchObject({
      type: {code: "INVALID_BLOCK_SSZ"},
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("keeps contribution bytes unchanged when the decoded bitvector is mutated", async () => {
    const type = ssz.altair.SignedContributionAndProof;
    const value = type.defaultValue();
    const bytes = type.serialize(value);
    const originalBytes = Uint8Array.from(bytes);
    vi.spyOn(core, "validateApiSyncCommitteeContributionAndProof").mockImplementation(async (decoded) => {
      decoded.message.contribution.aggregationBits.set(0, true);
      expect(decoded.message.contribution.aggregationBits.getTrueBitIndexes()).toEqual([0]);
      return accept(undefined);
    });
    expect(await core.validateApiSyncCommitteeContributionAndProofBytes(bytes)).toEqual(accept(undefined));
    expect(bytes).toEqual(originalBytes);
  });

  it.each(engineModes)("preserves proposer signature errors with beaconEngineMode=%s", async (beaconEngineMode) => {
    const type = core.config.getForkTypes(0).SignedBeaconBlock;
    const block = type.defaultValue();
    const error = new GossipActionError(GossipAction.REJECT, {code: "INVALID_SIGNATURE"});
    vi.spyOn(core, "verifyAndObserveBlockProposer").mockRejectedValue(error);
    await expect(
      facade(beaconEngineMode).verifyAndObserveBlockProposer(type.serialize(block), block, "0x01")
    ).rejects.toBe(error);
  });

  it.each(engineModes)("verifies envelope publication with beaconEngineMode=%s", async (beaconEngineMode) => {
    const type = ssz.gloas.SignedExecutionPayloadEnvelope;
    const envelope = type.defaultValue();
    const bytes = type.serialize(envelope);
    const deserialize = vi.spyOn(type, "deserialize");
    const validate = vi.spyOn(core, "verifyEnvelopeForPublish").mockResolvedValue(undefined);
    await facade(beaconEngineMode).verifyEnvelopeForPublish(bytes, envelope, "0x01");
    expect(validate).toHaveBeenCalledExactlyOnceWith(envelope, "0x01");
    expect(validate.mock.calls[0][0] === envelope).toBe(beaconEngineMode === BeaconEngineMode.MainThread);
    expect(deserialize).toHaveBeenCalledTimes(beaconEngineMode === BeaconEngineMode.Worker ? 1 : 0);
  });

  it("rejects malformed envelopes before publication checks", async () => {
    const validate = vi.spyOn(core, "verifyEnvelopeForPublish");
    await expect(core.verifyEnvelopeForPublishBytes(new Uint8Array(), "0x01")).rejects.toMatchObject({statusCode: 400});
    expect(validate).not.toHaveBeenCalled();
  });

  it.each(engineModes)("preserves publication API errors with beaconEngineMode=%s", async (beaconEngineMode) => {
    const type = ssz.gloas.SignedExecutionPayloadEnvelope;
    const envelope = type.defaultValue();
    const error = new ApiError(404, "Block not found");
    vi.spyOn(core, "verifyEnvelopeForPublish").mockRejectedValue(error);
    await expect(
      facade(beaconEngineMode).verifyEnvelopeForPublish(type.serialize(envelope), envelope, "0x01")
    ).rejects.toBe(error);
  });
});
