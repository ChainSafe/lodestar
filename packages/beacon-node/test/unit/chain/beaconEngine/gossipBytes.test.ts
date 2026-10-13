import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BitArray, Type} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {GossipAction, GossipActionError, GossipErrorCode} from "../../../../src/chain/errors/gossipValidation.js";
import * as aggregateValidation from "../../../../src/chain/validation/aggregateAndProof.js";
import * as attestationValidation from "../../../../src/chain/validation/attestation.js";
import * as attesterSlashingValidation from "../../../../src/chain/validation/attesterSlashing.js";
import * as blobValidation from "../../../../src/chain/validation/blobSidecar.js";
import * as blsChangeValidation from "../../../../src/chain/validation/blsToExecutionChange.js";
import * as columnValidation from "../../../../src/chain/validation/dataColumnSidecar.js";
import * as bidValidation from "../../../../src/chain/validation/executionPayloadBid.js";
import * as envelopeValidation from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import * as payloadAttestationValidation from "../../../../src/chain/validation/payloadAttestationMessage.js";
import * as preferencesValidation from "../../../../src/chain/validation/proposerPreferences.js";
import * as proposerSlashingValidation from "../../../../src/chain/validation/proposerSlashing.js";
import * as syncValidation from "../../../../src/chain/validation/syncCommittee.js";
import * as contributionValidation from "../../../../src/chain/validation/syncCommitteeContributionAndProof.js";
import * as exitValidation from "../../../../src/chain/validation/voluntaryExit.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

function createMessage<T extends object>(type: Type<T>) {
  const value = type.defaultValue();
  const bytes = type.serialize(value);
  return {value, bytes, deserialize: vi.spyOn(type, "deserialize")};
}

describe("BeaconEngine gossip bytes", () => {
  let engine: BeaconEngine;

  beforeEach(() => {
    engine = getMockedBeaconChain().beaconEngine;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "decodes from gossip through validation with beaconEngineWorker=%s",
    async (beaconEngineWorker) => {
      vi.useFakeTimers();
      const chain = getMockedBeaconChain();
      const cache = new SerializedCache({cacheDeserialized: !beaconEngineWorker});
      chain.opts.beaconEngineWorker = beaconEngineWorker;
      Object.defineProperty(chain, "beaconEngine", {value: engine});
      Object.defineProperty(chain, "serializedCache", {value: cache});
      Object.defineProperty(engine, "serializedCache", {value: beaconEngineWorker ? undefined : cache});
      engine.validateGossipVoluntaryExit = BeaconEngine.prototype.validateGossipVoluntaryExit.bind(engine);
      const validate = vi.spyOn(exitValidation, "validateGossipVoluntaryExit").mockResolvedValue(undefined);
      const {bytes, deserialize} = createMessage(ssz.phase0.SignedVoluntaryExit);
      const observed = vi.fn();
      chain.emitter.on(routes.events.EventType.voluntaryExit, observed);
      const handlers = getGossipHandlers({
        chain,
        config: chain.config,
        logger: chain.logger,
        metrics: null,
        events: new NetworkEventBus(),
        core: {} as INetworkCore,
      });
      const handler = handlers[GossipType.voluntary_exit] as SequentialGossipHandler<GossipType.voluntary_exit>;
      expect(
        await handler({
          gossipData: {serializedData: bytes},
          peerIdStr: "peer",
          seenTimestampSec: 1,
          topic: {boundary: {fork: ForkName.phase0, epoch: 0}, type: GossipType.voluntary_exit},
        })
      ).toMatchObject({status: "accept"});
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 2 : 1);
      expect(observed).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(observed).toHaveBeenCalledOnce();
      expect(observed.mock.calls[0][0] === validate.mock.calls[0][0]).toBe(!beaconEngineWorker);
      expect(cache.getDeserialized(bytes)).toBe(beaconEngineWorker ? undefined : observed.mock.calls[0][0]);
      expect(observed.mock.calls[0][0].signature.buffer).toBe(bytes.buffer);
      expect(validate.mock.calls[0][0].signature.buffer).toBe(bytes.buffer);
    }
  );

  describe.each([ForkName.phase0, ForkName.electra])("%s aggregate bytes", (fork) => {
    it.each([false, true])("preserves bitlists with beaconEngineWorker=%s", async (beaconEngineWorker) => {
      const chain = getMockedBeaconChain();
      const cache = new SerializedCache({cacheDeserialized: !beaconEngineWorker});
      chain.opts.beaconEngineWorker = beaconEngineWorker;
      Object.defineProperty(chain, "beaconEngine", {value: engine});
      Object.defineProperty(chain, "serializedCache", {value: cache});
      Object.defineProperty(engine, "serializedCache", {value: beaconEngineWorker ? undefined : cache});
      engine.validateGossipAggregateAndProof = BeaconEngine.prototype.validateGossipAggregateAndProof.bind(engine);
      const type = sszTypesFor(fork).SignedAggregateAndProof;
      const value = type.defaultValue();
      value.message.aggregate.aggregationBits = BitArray.fromSingleBit(9, 8);
      const bytes = type.serialize(value);
      const originalBytes = Uint8Array.from(bytes);
      const deserialize = vi.spyOn(type, "deserialize");
      const validate = vi
        .spyOn(aggregateValidation, "validateGossipAggregateAndProof")
        .mockRejectedValue(new GossipActionError(GossipAction.IGNORE, {code: "TEST_IGNORE"}));
      const handlers = getGossipHandlers({
        chain,
        config: chain.config,
        logger: chain.logger,
        metrics: null,
        events: new NetworkEventBus(),
        core: {} as INetworkCore,
      });
      const handler = handlers[
        GossipType.beacon_aggregate_and_proof
      ] as SequentialGossipHandler<GossipType.beacon_aggregate_and_proof>;
      expect(
        await handler({
          gossipData: {serializedData: bytes},
          peerIdStr: "peer",
          seenTimestampSec: 1,
          topic: {boundary: {fork, epoch: 0}, type: GossipType.beacon_aggregate_and_proof},
        })
      ).toMatchObject({status: "ignore", code: "TEST_IGNORE"});
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 2 : 1);
      expect(validate).toHaveBeenCalledExactlyOnceWith(fork, value, bytes);
      expect(bytes).toEqual(originalBytes);
      validate.mock.calls[0][1].message.aggregate.aggregationBits.set(0, true);
      expect(bytes).toEqual(originalBytes);
    });
  });

  const cases = [
    {
      name: "aggregate phase0",
      createMessage: () => createMessage(ssz.phase0.SignedAggregateAndProof),
      validate: () => vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipAggregateAndProof.call(engine, bytes, ForkName.phase0, 1),
    },
    {
      name: "aggregate electra",
      createMessage: () => createMessage(ssz.electra.SignedAggregateAndProof),
      validate: () => vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipAggregateAndProof.call(engine, bytes, ForkName.electra, 1),
    },
    {
      name: "sync committee",
      createMessage: () => createMessage(ssz.altair.SyncCommitteeMessage),
      validate: () => vi.spyOn(syncValidation, "validateGossipSyncCommittee"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipSyncCommittee.call(engine, bytes, 0),
    },
    {
      name: "sync contribution",
      createMessage: () => createMessage(ssz.altair.SignedContributionAndProof),
      validate: () => vi.spyOn(contributionValidation, "validateSyncCommitteeGossipContributionAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateSyncCommitteeGossipContributionAndProof.call(engine, bytes),
    },
    {
      name: "attester slashing phase0",
      createMessage: () => createMessage(ssz.phase0.AttesterSlashing),
      validate: () => vi.spyOn(attesterSlashingValidation, "validateGossipAttesterSlashing"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipAttesterSlashing.call(engine, bytes, ForkName.phase0),
    },
    {
      name: "attester slashing electra",
      createMessage: () => createMessage(ssz.electra.AttesterSlashing),
      validate: () => vi.spyOn(attesterSlashingValidation, "validateGossipAttesterSlashing"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipAttesterSlashing.call(engine, bytes, ForkName.electra),
    },
    {
      name: "proposer slashing",
      createMessage: () => createMessage(ssz.phase0.ProposerSlashing),
      validate: () => vi.spyOn(proposerSlashingValidation, "validateGossipProposerSlashing"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipProposerSlashing.call(engine, bytes),
    },
    {
      name: "voluntary exit",
      createMessage: () => createMessage(ssz.phase0.SignedVoluntaryExit),
      validate: () => vi.spyOn(exitValidation, "validateGossipVoluntaryExit"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipVoluntaryExit.call(engine, bytes),
    },
    {
      name: "bls change",
      createMessage: () => createMessage(ssz.capella.SignedBLSToExecutionChange),
      validate: () => vi.spyOn(blsChangeValidation, "validateGossipBlsToExecutionChange"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipBlsToExecutionChange.call(engine, bytes),
    },
    {
      name: "blob sidecar",
      createMessage: () => createMessage(ssz.deneb.BlobSidecar),
      validate: () => vi.spyOn(blobValidation, "validateGossipBlobSidecar"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipBlobSidecar.call(engine, bytes, ForkName.deneb, 0),
    },
    {
      name: "fulu data column",
      createMessage: () => createMessage(ssz.fulu.DataColumnSidecar),
      validate: () => vi.spyOn(columnValidation, "validateGossipFuluDataColumnSidecar"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipFuluDataColumnSidecar.call(engine, bytes, 0),
    },
    {
      name: "gloas data column",
      createMessage: () => createMessage(ssz.gloas.DataColumnSidecar),
      validate: () => vi.spyOn(columnValidation, "validateGossipGloasDataColumnSidecar"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipGloasDataColumnSidecar.call(engine, bytes, 0),
    },
    {
      name: "execution payload envelope",
      createMessage: () => createMessage(ssz.gloas.SignedExecutionPayloadEnvelope),
      validate: () => vi.spyOn(envelopeValidation, "validateGossipExecutionPayloadEnvelope"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipExecutionPayloadEnvelope.call(engine, bytes, {
          source: PayloadEnvelopeInputSource.gossip,
          seenTimestampSec: 1,
        }),
    },
    {
      name: "payload attestation",
      createMessage: () => createMessage(ssz.gloas.PayloadAttestationMessage),
      validate: () => vi.spyOn(payloadAttestationValidation, "validateGossipPayloadAttestationMessage"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipPayloadAttestationMessage.call(engine, bytes),
    },
    {
      name: "execution payload bid",
      createMessage: () => createMessage(ssz.gloas.SignedExecutionPayloadBid),
      validate: () => vi.spyOn(bidValidation, "validateGossipExecutionPayloadBid"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngine.prototype.validateGossipExecutionPayloadBid.call(engine, bytes, ForkName.gloas, 1),
    },
    {
      name: "proposer preferences",
      createMessage: () => createMessage(ssz.gloas.SignedProposerPreferences),
      validate: () => vi.spyOn(preferencesValidation, "validateGossipProposerPreferences"),
      invoke: (bytes: Uint8Array) => BeaconEngine.prototype.validateGossipProposerPreferences.call(engine, bytes),
    },
  ];

  describe.each(cases)("$name", (testCase) => {
    it.each([false, true])("decodes only in the worker with beaconEngineWorker=%s", async (beaconEngineWorker) => {
      const {value, bytes, deserialize} = testCase.createMessage();
      const cache = new SerializedCache({cacheDeserialized: !beaconEngineWorker});
      cache.set(value, bytes);
      Object.defineProperty(engine, "serializedCache", {value: beaconEngineWorker ? undefined : cache});
      const error = new GossipActionError(GossipAction.IGNORE, {code: "TEST_IGNORE"});
      const validate = testCase.validate().mockRejectedValue(error);
      expect(await testCase.invoke(bytes)).toMatchObject({status: "ignore", code: "TEST_IGNORE", error});
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
      expect(validate).toHaveBeenCalledOnce();
      expect(validate.mock.calls.flat()).toContainEqual(value);
      expect(validate.mock.calls.flat().includes(value)).toBe(!beaconEngineWorker);
      expect(engine.logger.error).not.toHaveBeenCalled();
    });

    it("rejects malformed SSZ without running validation", async () => {
      const validate = testCase.validate();
      expect(await testCase.invoke(new Uint8Array())).toMatchObject({
        status: "reject",
        code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE,
      });
      expect(validate).not.toHaveBeenCalled();
      expect(engine.logger.error).not.toHaveBeenCalled();
    });

    it("preserves validation rejections", async () => {
      const {bytes} = testCase.createMessage();
      const error = new GossipActionError(GossipAction.REJECT, {code: "TEST_REJECT"});
      testCase.validate().mockRejectedValue(error);
      expect(await testCase.invoke(bytes)).toMatchObject({status: "reject", code: "TEST_REJECT", error});
      expect(engine.logger.error).not.toHaveBeenCalled();
    });

    it("logs and ignores unexpected asynchronous failures", async () => {
      const {bytes} = testCase.createMessage();
      const error = new Error("validation failed");
      testCase.validate().mockRejectedValue(error);
      expect(await testCase.invoke(bytes)).toEqual({status: "ignore", code: "UNEXPECTED_ERROR"});
      expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
    });

    it("logs and ignores unexpected synchronous failures", async () => {
      const {bytes} = testCase.createMessage();
      const error = new Error("validation failed");
      testCase.validate().mockImplementation(() => {
        throw error;
      });
      expect(await testCase.invoke(bytes)).toEqual({status: "ignore", code: "UNEXPECTED_ERROR"});
      expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
    });

    it("does not classify a cache failure as invalid peer bytes", async () => {
      const {bytes} = testCase.createMessage();
      const cache = new SerializedCache({cacheDeserialized: true});
      Object.defineProperty(engine, "serializedCache", {value: cache});
      const error = new Error("cache failed");
      vi.spyOn(cache, "getDeserialized").mockImplementation(() => {
        throw error;
      });
      expect(await testCase.invoke(bytes)).toEqual({status: "ignore", code: "UNEXPECTED_ERROR"});
      expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
    });
  });

  it("catches failures after validation succeeds", async () => {
    const {bytes} = createMessage(ssz.gloas.SignedProposerPreferences);
    vi.spyOn(preferencesValidation, "validateGossipProposerPreferences").mockResolvedValue(undefined);
    const error = new Error("pool failed");
    vi.spyOn(engine.proposerPreferencesPool, "add").mockImplementation(() => {
      throw error;
    });
    expect(await BeaconEngine.prototype.validateGossipProposerPreferences.call(engine, bytes)).toEqual({
      status: "ignore",
      code: "UNEXPECTED_ERROR",
    });
    expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
  });

  it("returns an ignore for every attestation if the batch unexpectedly fails", async () => {
    const error = new Error("batch failed");
    vi.spyOn(attestationValidation, "validateGossipAttestationsSameAttData").mockRejectedValue(error);
    const attestation: attestationValidation.GossipAttestation = {
      attestation: null,
      serializedData: new Uint8Array(),
      attSlot: 1,
      attDataBase64: "test",
      subnet: 0,
    };
    const result = await BeaconEngine.prototype.validateGossipAttestationsSameAttData.call(
      engine,
      ForkName.electra,
      [attestation, attestation],
      [1, 1]
    );
    expect(result).toEqual({
      results: [
        {status: "ignore", code: "UNEXPECTED_ERROR"},
        {status: "ignore", code: "UNEXPECTED_ERROR"},
      ],
      batchableBls: false,
    });
    expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
  });
});
