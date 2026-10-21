import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BitArray, Type} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {GossipValidationResult} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {GossipAction, GossipActionError, GossipErrorCode} from "../../../../src/chain/errors/gossipValidation.js";
import {AggregatedAttestationPool} from "../../../../src/chain/opPools/aggregatedAttestationPool.js";
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
import {getMockedBeaconChain, withBeaconEngineFacade} from "../../../mocks/mockedBeaconChain.js";

function createMessage<T extends object>(type: Type<T>) {
  const value = type.defaultValue();
  const bytes = type.serialize(value);
  return {value, bytes, deserialize: vi.spyOn(type, "deserialize")};
}

function createObjectMessage<T extends object>(
  type: Type<T>,
  invoke: (value: T, bytes: Uint8Array) => Promise<GossipValidationResult<unknown>>,
  invokeFacade: (facade: BeaconEngine, value: T, bytes: Uint8Array) => Promise<GossipValidationResult<unknown>>
) {
  const message = createMessage(type);
  return {
    ...message,
    serialize: vi.spyOn(type, "serialize"),
    invokeObject: () => invoke(message.value, message.bytes),
    invokeFacade: (facade: BeaconEngine) => invokeFacade(facade, message.value, message.bytes),
  };
}

describe("BeaconEngineCore gossip bytes", () => {
  let engine: BeaconEngineCore;
  const candidateCacheAccess = vi.fn(() => {
    throw Error("Non-block validation must not access BlockSerializedCache");
  });

  beforeEach(() => {
    engine = getMockedBeaconChain().beaconEngine;
    for (const method of [
      "validateGossipAggregateAndProof",
      "validateApiAggregateAndProof",
      "validateGossipSyncCommittee",
      "validateSyncCommitteeGossipContributionAndProof",
      "validateGossipAttesterSlashing",
      "validateGossipProposerSlashing",
      "validateGossipVoluntaryExit",
      "validateGossipBlsToExecutionChange",
      "validateGossipBlobSidecar",
      "validateGossipFuluDataColumnSidecar",
      "validateGossipGloasDataColumnSidecar",
      "validateGossipExecutionPayloadEnvelope",
      "validateGossipPayloadAttestationMessage",
      "validateGossipExecutionPayloadBid",
      "validateGossipProposerPreferences",
    ] as const) {
      Object.defineProperty(engine, method, {value: BeaconEngineCore.prototype[method], configurable: true});
    }
    candidateCacheAccess.mockClear();
    Object.defineProperty(engine, "blockSerializedCache", {get: candidateCacheAccess});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(candidateCacheAccess).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "decodes from gossip through validation with beaconEngineWorker=%s",
    async (beaconEngineWorker) => {
      vi.useFakeTimers();
      const chain = getMockedBeaconChain();
      const cache = new SerializedCache();
      chain.opts.beaconEngineWorker = beaconEngineWorker;
      Object.defineProperty(chain, "beaconEngine", {value: engine});
      Object.defineProperty(chain, "serializedCache", {value: cache});
      const validate = vi.spyOn(exitValidation, "validateGossipVoluntaryExit").mockResolvedValue(undefined);
      const {bytes, deserialize} = createMessage(ssz.phase0.SignedVoluntaryExit);
      const observed = vi.fn();

      const facade = withBeaconEngineFacade(chain);
      facade.emitter.on(routes.events.EventType.voluntaryExit, observed);
      const handlers = getGossipHandlers({
        chain: facade,
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
      ).toMatchObject({err: null});
      expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 2 : 1);
      expect(observed).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(observed).toHaveBeenCalledOnce();
      expect(observed.mock.calls[0][0] === validate.mock.calls[0][0]).toBe(!beaconEngineWorker);
      expect(cache.get(observed.mock.calls[0][0])).toBeUndefined();
      expect(observed.mock.calls[0][0].signature.buffer).toBe(bytes.buffer);
      expect(validate.mock.calls[0][0].signature.buffer).toBe(bytes.buffer);
    }
  );

  describe.each([ForkName.phase0, ForkName.electra])("%s aggregate bytes", (fork) => {
    it.each([false, true])(
      "preserves signed API aggregates while the pool combines disjoint participants with beaconEngineWorker=%s",
      async (beaconEngineWorker) => {
        const types = sszTypesFor(fork);
        const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32));
        engine.aggregatedAttestationPool = new AggregatedAttestationPool(config);
        const aggregates = [0, 1].map((index) => {
          const value = types.SignedAggregateAndProof.defaultValue();
          const aggregate = value.message.aggregate;
          aggregate.aggregationBits = BitArray.fromSingleBit(9, index);
          if ("committeeBits" in aggregate) aggregate.committeeBits.set(0, true);
          const key = SecretKey.fromBytes(Buffer.alloc(32, index + 1));
          aggregate.signature = key.sign(ssz.phase0.AttestationData.hashTreeRoot(aggregate.data)).toBytes();
          value.message.aggregatorIndex = index;
          value.signature = key.sign(types.AggregateAndProof.hashTreeRoot(value.message)).toBytes();
          return value;
        });
        const originalBytes = aggregates.map((aggregate) => types.SignedAggregateAndProof.serialize(aggregate));
        vi.spyOn(aggregateValidation, "validateApiAggregateAndProof").mockImplementation(async (_fork, value) => ({
          indexedAttestation: {
            attestingIndices: [value.message.aggregatorIndex],
            data: value.message.aggregate.data,
            signature: value.message.aggregate.signature,
          },
          committeeValidatorIndices: Uint32Array.from({length: 9}, (_, i) => i),
          attDataRootHex: toRootHex(ssz.phase0.AttestationData.hashTreeRoot(value.message.aggregate.data)),
        }));

        const facade = new BeaconEngine({
          core: engine,
          config,
          clock: engine.clock,
          emitter: new ChainEventEmitter(),
          serializedCache: new SerializedCache(),
          beaconEngineWorker,
        });
        const publicationBytes = originalBytes.map((bytes) => Uint8Array.from(bytes));
        const results = await Promise.all(
          aggregates.map((aggregate, i) => facade.validateApiAggregateAndProof(publicationBytes[i], fork, aggregate))
        );

        expect(results.every(({err}) => err === null)).toBe(true);
        expect(engine.aggregatedAttestationPool.getAll()).toHaveLength(1);
        expect(engine.aggregatedAttestationPool.getAll()[0].aggregationBits.getTrueBitIndexes()).toEqual([0, 1]);
        for (const [i, aggregate] of aggregates.entries()) {
          expect(publicationBytes[i], `serialized aggregate ${i} changed`).toEqual(originalBytes[i]);
          expect(types.SignedAggregateAndProof.serialize(aggregate), `signed aggregate ${i} changed`).toEqual(
            originalBytes[i]
          );
        }
      }
    );

    it.each([false, true])("preserves bitlists with beaconEngineWorker=%s", async (beaconEngineWorker) => {
      const chain = getMockedBeaconChain();
      const cache = new SerializedCache();
      chain.opts.beaconEngineWorker = beaconEngineWorker;
      Object.defineProperty(chain, "beaconEngine", {value: engine});
      Object.defineProperty(chain, "serializedCache", {value: cache});
      const type = sszTypesFor(fork).SignedAggregateAndProof;
      const value = type.defaultValue();
      value.message.aggregate.aggregationBits = BitArray.fromSingleBit(9, 8);
      const bytes = type.serialize(value);
      const originalBytes = Uint8Array.from(bytes);
      const deserialize = vi.spyOn(type, "deserialize");
      const validate = vi
        .spyOn(aggregateValidation, "validateGossipAggregateAndProof")
        .mockRejectedValue(new GossipActionError(GossipAction.IGNORE, {code: "TEST_IGNORE"}));
      const facade = withBeaconEngineFacade(chain);
      const handlers = getGossipHandlers({
        chain: facade,
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
      ).toMatchObject({err: {status: "ignore", code: "TEST_IGNORE"}});
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
      createMessage: () =>
        createObjectMessage(
          ssz.phase0.SignedAggregateAndProof,
          (value, bytes) =>
            BeaconEngineCore.prototype.validateGossipAggregateAndProofObject.call(
              engine,
              {data: value, bytes},
              ForkName.phase0,
              1
            ),
          (facade, value, bytes) => facade.validateGossipAggregateAndProof(bytes, value, ForkName.phase0, 1)
        ),
      validate: () => vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipAggregateAndProof.call(engine, bytes, ForkName.phase0, 1),
    },
    {
      name: "aggregate electra",
      createMessage: () =>
        createObjectMessage(
          ssz.electra.SignedAggregateAndProof,
          (value, bytes) =>
            BeaconEngineCore.prototype.validateGossipAggregateAndProofObject.call(
              engine,
              {data: value, bytes},
              ForkName.electra,
              1
            ),
          (facade, value, bytes) => facade.validateGossipAggregateAndProof(bytes, value, ForkName.electra, 1)
        ),
      validate: () => vi.spyOn(aggregateValidation, "validateGossipAggregateAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipAggregateAndProof.call(engine, bytes, ForkName.electra, 1),
    },
    {
      name: "sync committee",
      createMessage: () =>
        createObjectMessage(
          ssz.altair.SyncCommitteeMessage,
          (value) => BeaconEngineCore.prototype.validateGossipSyncCommitteeObject.call(engine, value, 0),
          (facade, value, bytes) => facade.validateGossipSyncCommittee(bytes, value, 0)
        ),
      validate: () => vi.spyOn(syncValidation, "validateGossipSyncCommittee"),
      invoke: (bytes: Uint8Array) => BeaconEngineCore.prototype.validateGossipSyncCommittee.call(engine, bytes, 0),
    },
    {
      name: "sync contribution",
      createMessage: () =>
        createObjectMessage(
          ssz.altair.SignedContributionAndProof,
          (value) =>
            BeaconEngineCore.prototype.validateSyncCommitteeGossipContributionAndProofObject.call(engine, value),
          (facade, value, bytes) => facade.validateSyncCommitteeGossipContributionAndProof(bytes, value)
        ),
      validate: () => vi.spyOn(contributionValidation, "validateSyncCommitteeGossipContributionAndProof"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateSyncCommitteeGossipContributionAndProof.call(engine, bytes),
    },
    {
      name: "attester slashing phase0",
      createMessage: () =>
        createObjectMessage(
          ssz.phase0.AttesterSlashing,
          (value) =>
            BeaconEngineCore.prototype.validateGossipAttesterSlashingObject.call(engine, value, ForkName.phase0),
          (facade, value, bytes) => facade.validateGossipAttesterSlashing(bytes, value, ForkName.phase0)
        ),
      validate: () => vi.spyOn(attesterSlashingValidation, "validateGossipAttesterSlashing"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipAttesterSlashing.call(engine, bytes, ForkName.phase0),
    },
    {
      name: "attester slashing electra",
      createMessage: () =>
        createObjectMessage(
          ssz.electra.AttesterSlashing,
          (value) =>
            BeaconEngineCore.prototype.validateGossipAttesterSlashingObject.call(engine, value, ForkName.electra),
          (facade, value, bytes) => facade.validateGossipAttesterSlashing(bytes, value, ForkName.electra)
        ),
      validate: () => vi.spyOn(attesterSlashingValidation, "validateGossipAttesterSlashing"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipAttesterSlashing.call(engine, bytes, ForkName.electra),
    },
    {
      name: "proposer slashing",
      createMessage: () =>
        createObjectMessage(
          ssz.phase0.ProposerSlashing,
          (value) => BeaconEngineCore.prototype.validateGossipProposerSlashingObject.call(engine, value),
          (facade, value, bytes) => facade.validateGossipProposerSlashing(bytes, value)
        ),
      validate: () => vi.spyOn(proposerSlashingValidation, "validateGossipProposerSlashing"),
      invoke: (bytes: Uint8Array) => BeaconEngineCore.prototype.validateGossipProposerSlashing.call(engine, bytes),
    },
    {
      name: "voluntary exit",
      createMessage: () =>
        createObjectMessage(
          ssz.phase0.SignedVoluntaryExit,
          (value) => BeaconEngineCore.prototype.validateGossipVoluntaryExitObject.call(engine, value),
          (facade, value, bytes) => facade.validateGossipVoluntaryExit(bytes, value)
        ),
      validate: () => vi.spyOn(exitValidation, "validateGossipVoluntaryExit"),
      invoke: (bytes: Uint8Array) => BeaconEngineCore.prototype.validateGossipVoluntaryExit.call(engine, bytes),
    },
    {
      name: "bls change",
      createMessage: () =>
        createObjectMessage(
          ssz.capella.SignedBLSToExecutionChange,
          (value) => BeaconEngineCore.prototype.validateGossipBlsToExecutionChangeObject.call(engine, value),
          (facade, value, bytes) => facade.validateGossipBlsToExecutionChange(bytes, value)
        ),
      validate: () => vi.spyOn(blsChangeValidation, "validateGossipBlsToExecutionChange"),
      invoke: (bytes: Uint8Array) => BeaconEngineCore.prototype.validateGossipBlsToExecutionChange.call(engine, bytes),
    },
    {
      name: "blob sidecar",
      createMessage: () =>
        createObjectMessage(
          ssz.deneb.BlobSidecar,
          (value) => BeaconEngineCore.prototype.validateGossipBlobSidecarObject.call(engine, value, ForkName.deneb, 0),
          (facade, value, bytes) => facade.validateGossipBlobSidecar(bytes, value, ForkName.deneb, 0)
        ),
      validate: () => vi.spyOn(blobValidation, "validateGossipBlobSidecar"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipBlobSidecar.call(engine, bytes, ForkName.deneb, 0),
    },
    {
      name: "fulu data column",
      createMessage: () =>
        createObjectMessage(
          ssz.fulu.DataColumnSidecar,
          (value) => BeaconEngineCore.prototype.validateGossipFuluDataColumnSidecarObject.call(engine, value, 0),
          (facade, value, bytes) => facade.validateGossipFuluDataColumnSidecar(bytes, value, 0)
        ),
      validate: () => vi.spyOn(columnValidation, "validateGossipFuluDataColumnSidecar"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipFuluDataColumnSidecar.call(engine, bytes, 0),
    },
    {
      name: "gloas data column",
      createMessage: () =>
        createObjectMessage(
          ssz.gloas.DataColumnSidecar,
          (value) => BeaconEngineCore.prototype.validateGossipGloasDataColumnSidecarObject.call(engine, value, 0),
          (facade, value, bytes) => facade.validateGossipGloasDataColumnSidecar(bytes, value, 0)
        ),
      validate: () => vi.spyOn(columnValidation, "validateGossipGloasDataColumnSidecar"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipGloasDataColumnSidecar.call(engine, bytes, 0),
    },
    {
      name: "execution payload envelope",
      createMessage: () =>
        createObjectMessage(
          ssz.gloas.SignedExecutionPayloadEnvelope,
          (value) =>
            BeaconEngineCore.prototype.validateGossipExecutionPayloadEnvelopeObject.call(engine, value, {
              source: PayloadEnvelopeInputSource.gossip,
              seenTimestampSec: 1,
            }),
          (facade, value, bytes) =>
            facade.validateGossipExecutionPayloadEnvelope(bytes, value, {
              source: PayloadEnvelopeInputSource.gossip,
              seenTimestampSec: 1,
            })
        ),
      validate: () => vi.spyOn(envelopeValidation, "validateGossipExecutionPayloadEnvelope"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipExecutionPayloadEnvelope.call(engine, bytes, {
          source: PayloadEnvelopeInputSource.gossip,
          seenTimestampSec: 1,
        }),
    },
    {
      name: "payload attestation",
      createMessage: () =>
        createObjectMessage(
          ssz.gloas.PayloadAttestationMessage,
          (value) => BeaconEngineCore.prototype.validateGossipPayloadAttestationMessageObject.call(engine, value),
          (facade, value, bytes) => facade.validateGossipPayloadAttestationMessage(bytes, value)
        ),
      validate: () => vi.spyOn(payloadAttestationValidation, "validateGossipPayloadAttestationMessage"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipPayloadAttestationMessage.call(engine, bytes),
    },
    {
      name: "execution payload bid",
      createMessage: () =>
        createObjectMessage(
          ssz.gloas.SignedExecutionPayloadBid,
          (value) => BeaconEngineCore.prototype.validateGossipExecutionPayloadBidObject.call(engine, value, 1),
          (facade, value, bytes) => facade.validateGossipExecutionPayloadBid(bytes, value, ForkName.gloas, 1)
        ),
      validate: () => vi.spyOn(bidValidation, "validateGossipExecutionPayloadBid"),
      invoke: (bytes: Uint8Array) =>
        BeaconEngineCore.prototype.validateGossipExecutionPayloadBid.call(engine, bytes, ForkName.gloas, 1),
    },
    {
      name: "proposer preferences",
      createMessage: () =>
        createObjectMessage(
          ssz.gloas.SignedProposerPreferences,
          (value) => BeaconEngineCore.prototype.validateGossipProposerPreferencesObject.call(engine, value),
          (facade, value, bytes) => facade.validateGossipProposerPreferences(bytes, value)
        ),
      validate: () => vi.spyOn(preferencesValidation, "validateGossipProposerPreferences"),
      invoke: (bytes: Uint8Array) => BeaconEngineCore.prototype.validateGossipProposerPreferences.call(engine, bytes),
    },
  ];

  describe.each(cases)("$name", (testCase) => {
    it.each([GossipAction.IGNORE, GossipAction.REJECT])(
      "preserves %s for supplied objects without serialization or cache lookup",
      async (action) => {
        const {value, bytes, serialize, deserialize, invokeObject} = testCase.createMessage();
        const originalBytes = Uint8Array.from(bytes);
        const error = new GossipActionError(action, {code: "TEST_VERDICT"});
        const validate = testCase.validate().mockRejectedValue(error);

        expect(await invokeObject()).toMatchObject({
          err: {status: action === GossipAction.IGNORE ? "ignore" : "reject", code: "TEST_VERDICT", error},
        });
        expect(validate.mock.calls.flat()).toContain(value);
        expect(serialize).not.toHaveBeenCalled();
        expect(deserialize).not.toHaveBeenCalled();
        expect(bytes).toEqual(originalBytes);
        expect(engine.logger.error).not.toHaveBeenCalled();
      }
    );

    it("logs and ignores unexpected failures for supplied objects", async () => {
      const {invokeObject} = testCase.createMessage();
      const error = new Error("validation failed");
      testCase.validate().mockRejectedValue(error);
      expect(await invokeObject()).toEqual({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
      expect(engine.logger.error).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        {code: "UNEXPECTED_ERROR"},
        error
      );
    });

    it.each([false, true])(
      "routes original objects or worker bytes with beaconEngineWorker=%s",
      async (beaconEngineWorker) => {
        const {value, bytes, serialize, deserialize, invokeFacade} = testCase.createMessage();
        const originalBytes = Uint8Array.from(bytes);
        const cache = new SerializedCache();
        const facade = new BeaconEngine({
          core: engine,
          config: engine.config,
          clock: engine.clock,
          emitter: new ChainEventEmitter(),
          serializedCache: cache,
          beaconEngineWorker,
        });
        const lookup = vi.spyOn(cache, "get");
        const error = new GossipActionError(GossipAction.IGNORE, {code: "TEST_IGNORE"});
        const validate = testCase.validate().mockRejectedValue(error);
        expect(await invokeFacade(facade)).toMatchObject({err: {status: "ignore", code: "TEST_IGNORE", error}});
        expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
        expect(serialize).not.toHaveBeenCalled();
        expect(lookup).not.toHaveBeenCalled();
        expect(validate).toHaveBeenCalledOnce();
        expect(validate.mock.calls.flat()).toContainEqual(value);
        expect(validate.mock.calls.flat().includes(value)).toBe(!beaconEngineWorker);
        expect(bytes).toEqual(originalBytes);
        expect(engine.logger.error).not.toHaveBeenCalled();
      }
    );

    it("rejects malformed SSZ without running validation", async () => {
      const validate = testCase.validate();
      expect(await testCase.invoke(new Uint8Array())).toMatchObject({
        err: {
          status: "reject",
          code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE,
        },
      });
      expect(validate).not.toHaveBeenCalled();
      expect(engine.logger.error).not.toHaveBeenCalled();
    });

    it("preserves validation rejections", async () => {
      const {bytes} = testCase.createMessage();
      const error = new GossipActionError(GossipAction.REJECT, {code: "TEST_REJECT"});
      testCase.validate().mockRejectedValue(error);
      expect(await testCase.invoke(bytes)).toMatchObject({err: {status: "reject", code: "TEST_REJECT", error}});
      expect(engine.logger.error).not.toHaveBeenCalled();
    });

    it("logs and ignores unexpected asynchronous failures", async () => {
      const {bytes} = testCase.createMessage();
      const error = new Error("validation failed");
      testCase.validate().mockRejectedValue(error);
      expect(await testCase.invoke(bytes)).toEqual({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
      expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
    });

    it("logs and ignores unexpected synchronous failures", async () => {
      const {bytes} = testCase.createMessage();
      const error = new Error("validation failed");
      testCase.validate().mockImplementation(() => {
        throw error;
      });
      expect(await testCase.invoke(bytes)).toEqual({err: {status: "ignore", code: "UNEXPECTED_ERROR"}});
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
    expect(await BeaconEngineCore.prototype.validateGossipProposerPreferences.call(engine, bytes)).toEqual({
      err: {
        status: "ignore",
        code: "UNEXPECTED_ERROR",
      },
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
    const result = await BeaconEngineCore.prototype.validateGossipAttestationsSameAttData.call(
      engine,
      ForkName.electra,
      [attestation, attestation],
      [1, 1]
    );
    expect(result).toEqual({
      results: [
        {err: {status: "ignore", code: "UNEXPECTED_ERROR"}},
        {err: {status: "ignore", code: "UNEXPECTED_ERROR"}},
      ],
      batchableBls: false,
    });
    expect(engine.logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, error);
  });
});
