import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {WireFormat, routes} from "@lodestar/api";
import {getClient} from "@lodestar/api/builder";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {LogLevel, testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import * as stateTransition from "@lodestar/state-transition";
import {ensureInteropPubkeyCache} from "@lodestar/state-transition/test-utils";
import {ssz} from "@lodestar/types";
import {byteArrayEquals, defer, toRootHex} from "@lodestar/utils";
import {getLodestarApi} from "../../../../src/api/impl/lodestar/index.js";
import {ApiModules} from "../../../../src/api/impl/types.js";
import {HistoricalStateRegen} from "../../../../src/chain/archiveStore/historicalState/historicalStateRegen.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent} from "../../../../src/chain/beaconEngine/events.js";
import {AnchorSummary, EngineBootstrap} from "../../../../src/chain/beaconEngine/initialization.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent} from "../../../../src/chain/emitter.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import * as blockValidation from "../../../../src/chain/validation/block.js";
import * as proposerSlashingValidation from "../../../../src/chain/validation/proposerSlashing.js";
import * as voluntaryExitValidation from "../../../../src/chain/validation/voluntaryExit.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {defaultExecutionBuilderOpts} from "../../../../src/execution/builder/index.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {aggregateMetrics, createMetrics} from "../../../../src/metrics/index.js";
import {initDevState} from "../../../../src/node/utils/state.js";
import {Clock, ClockEvent} from "../../../../src/util/clock.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {TestChainModules, createBeaconChain, initializeTestChain} from "../../../utils/chain.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {createTestBeaconEngine, getBeaconEngineCore} from "../../../utils/engine.js";

const executionBuilderApi = vi.hoisted(() => ({
  registerValidator: vi.fn(),
  getHeader: vi.fn(),
  submitBlindedBlock: vi.fn(),
  submitBlindedBlockV2: vi.fn(),
}));

vi.mock("@lodestar/api/builder", () => ({
  getClient: vi.fn(() => ({
    ...executionBuilderApi,
    submitBuilderPreferences: vi.fn().mockResolvedValue({assertOk: () => {}}),
    getExecutionPayloadBid: vi.fn().mockResolvedValue({value: () => undefined}),
    submitSignedBeaconBlock: vi.fn().mockResolvedValue({assertOk: () => {}}),
    status: vi.fn().mockResolvedValue({assertOk: () => {}}),
  })),
}));

describe("bytes-based engine startup", () => {
  const config = createChainForkConfig(chainConfig);
  const opts = {
    ...defaultChainOptions,
    blsVerifyAllMainThread: true,
    disableLightClientServer: true,
    disablePrepareNextSlot: true,
    disableArchiveOnCheckpoint: true,
  };
  let db: BeaconDb;
  let closeDb: () => Promise<void>;
  let modules: TestChainModules;
  let chain: BeaconChain | undefined;
  let engine: BeaconEngineCore | undefined;
  let clock: ClockStopped;
  let stateRoot: Uint8Array;

  beforeEach(async () => {
    ({db, close: closeDb} = await startIsolatedTmpBeaconDb(config));
    const state = initDevState(config, 16, {genesisTime: 0});
    state.commit();
    stateRoot = state.hashTreeRoot();
    clock = new ClockStopped(0);
    modules = {
      privateKey: await generateKeyPair("secp256k1"),
      config: createBeaconConfig(config, state.genesisValidatorsRoot),
      pubkeyCache,
      db,
      dbName: "test",
      dataDir: "test",
      logger: testLogger(),
      clock,
      processShutdownCallback: () => {},
      metrics: null,
      validatorMonitorOpts: null,
      anchorStateBytes: state.serialize(),
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    };
    const prepare = BeaconEngineCore.prototype.prepareAnchorState;
    vi.spyOn(BeaconEngineCore.prototype, "prepareAnchorState").mockImplementation(function (
      this: BeaconEngineCore,
      bytes
    ) {
      engine = this;
      return prepare.call(this, bytes);
    });
  });

  afterEach(async () => {
    await chain?.close();
    await engine?.close();
    chain = undefined;
    engine = undefined;
    modules.metrics?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await closeDb();
  });

  it("filters validator registrations against the head state when the shared pubkey cache is ahead", async () => {
    chain = await createBeaconChain(opts, modules);
    const validatorCount = getBeaconEngineCore(chain.beaconEngine).getHeadState().validatorCount;
    ensureInteropPubkeyCache(validatorCount + 1);
    const index = chain.pubkeyCache.getIndex(chain.pubkeyCache.getPubkeyBytesOrThrow(validatorCount));
    expect(index).toBe(validatorCount);

    expect(chain.beaconEngine.getActiveOrPendingValidators([0, validatorCount])).toEqual(new Set([0]));
  });

  it("serves persisted checkpoint bytes through the engine with latest-safe selection and API errors", async () => {
    chain = await createBeaconChain({...opts, nHistoricalStatesFileDataStore: false}, modules);
    await chain.beaconEngine.initRegen();
    const api = getLodestarApi({
      chain,
      config,
      db,
      network: {} as ApiModules["network"],
      sync: {} as ApiModules["sync"],
    });
    const checkpoint = {epoch: 0, root: Buffer.alloc(32, 1)};
    const checkpointId = `${toRootHex(checkpoint.root)}:${checkpoint.epoch}`;
    await expect(api.getPersistedCheckpointState({})).rejects.toMatchObject({
      statusCode: 404,
      message: "Latest safe checkpoint state not found",
    });
    await expect(api.getPersistedCheckpointState({checkpointId})).rejects.toMatchObject({
      statusCode: 404,
      message: `Checkpoint state not found for id ${checkpointId}`,
    });

    const key = ssz.phase0.Checkpoint.serialize(checkpoint);
    await db.checkpointState.putBinary(key, modules.anchorStateBytes);
    for (const id of [checkpointId, undefined]) {
      const response = await api.getPersistedCheckpointState({checkpointId: id}, {returnBytes: true});
      expect(
        response.data instanceof Uint8Array && byteArrayEquals(response.data, modules.anchorStateBytes),
        `state bytes for ${id ?? "latest"}`
      ).toBe(true);
      expect(response.meta, `fork metadata for ${id ?? "latest"}`).toEqual({version: ForkName.phase0});
    }

    const competingKey = ssz.phase0.Checkpoint.serialize({...checkpoint, root: Buffer.alloc(32, 2)});
    await db.checkpointState.putBinary(competingKey, modules.anchorStateBytes);
    await expect(api.getPersistedCheckpointState({})).rejects.toMatchObject({statusCode: 404});
    const response = await api.getPersistedCheckpointState({checkpointId}, {returnBytes: true});
    expect(response.data instanceof Uint8Array && byteArrayEquals(response.data, modules.anchorStateBytes)).toBe(true);
  });

  it("forwards clock maintenance through the chain and stops forwarding before engine teardown", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    const core = getBeaconEngineCore(dependencies.beaconEngine);
    const pruneSlots = vi.spyOn(core.attestationPool, "prune");
    const pruneEpochs = vi.spyOn(core.seenAttesters, "prune");
    expect(core.clock).toBe(clock);
    expect(clock.listenerCount(ClockEvent.slot)).toBe(0);
    expect(clock.listenerCount(ClockEvent.epoch)).toBe(0);

    clock.setSlot(SLOTS_PER_EPOCH);
    clock.emit(ClockEvent.slot, clock.currentSlot);
    clock.emit(ClockEvent.epoch, clock.currentEpoch);
    expect(pruneSlots).not.toHaveBeenCalled();
    expect(pruneEpochs).not.toHaveBeenCalled();

    chain = new BeaconChain(opts, dependencies);
    const updateTime = vi.spyOn(core, "updateTime");
    const reprocess = vi.spyOn(chain.reprocessController, "onSlot");
    clock.emit(ClockEvent.slot, clock.currentSlot);
    clock.emit(ClockEvent.epoch, clock.currentEpoch);
    expect(core.forkChoice.getTime()).toBe(SLOTS_PER_EPOCH);
    expect(pruneSlots).toHaveBeenCalledExactlyOnceWith(SLOTS_PER_EPOCH);
    expect(pruneEpochs).toHaveBeenCalledExactlyOnceWith(1);
    expect(reprocess).toHaveBeenCalledExactlyOnceWith(SLOTS_PER_EPOCH);
    expect(updateTime.mock.invocationCallOrder[0]).toBeLessThan(pruneSlots.mock.invocationCallOrder[0]);
    expect(pruneSlots.mock.invocationCallOrder[0]).toBeLessThan(reprocess.mock.invocationCallOrder[0]);

    const close = chain.beaconEngine.close.bind(chain.beaconEngine);
    vi.spyOn(chain.beaconEngine, "close").mockImplementation(async () => {
      expect(clock.listenerCount(ClockEvent.slot)).toBe(0);
      expect(clock.listenerCount(ClockEvent.epoch)).toBe(0);
      clock.emit(ClockEvent.slot, SLOTS_PER_EPOCH + 1);
      clock.emit(ClockEvent.epoch, 2);
      expect(updateTime).toHaveBeenCalledOnce();
      expect(pruneSlots).toHaveBeenCalledOnce();
      expect(pruneEpochs).toHaveBeenCalledOnce();
      await close();
    });
    await chain.close();
  });

  it("forwards missed slots and epochs in order when an engine clock read catches up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const controller = new AbortController();
    modules.clock = new Clock({config, genesisTime: 0, signal: controller.signal});
    try {
      chain = await createBeaconChain(opts, modules);
      const core = getBeaconEngineCore(chain.beaconEngine);
      const forwarded: string[] = [];
      const onSlot = core.onSlot;
      const onEpoch = core.onEpoch;
      vi.spyOn(core, "onSlot").mockImplementation((slot) => {
        forwarded.push(`slot:${slot}`);
        onSlot(slot);
      });
      vi.spyOn(core, "onEpoch").mockImplementation((epoch) => {
        forwarded.push(`epoch:${epoch}`);
        onEpoch(epoch);
      });

      vi.setSystemTime((SLOTS_PER_EPOCH + 1) * config.SLOT_DURATION_MS);
      expect(core.clock.currentSlot).toBe(SLOTS_PER_EPOCH + 1);
      expect(forwarded).toEqual([
        ...Array.from({length: SLOTS_PER_EPOCH}, (_, i) => `slot:${i + 1}`),
        "epoch:1",
        `slot:${SLOTS_PER_EPOCH + 1}`,
      ]);
      expect(core.forkChoice.getTime()).toBe(SLOTS_PER_EPOCH + 1);
      await chain.close();
      const sharedTick = vi.fn();
      modules.clock.on(ClockEvent.slot, sharedTick);
      await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
      expect(sharedTick).toHaveBeenCalledExactlyOnceWith(SLOTS_PER_EPOCH + 2);
    } finally {
      controller.abort();
    }
  });

  it("uses a worker-local clock for reads while only forwarded ticks drive maintenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    chain = await createBeaconChain({...opts, beaconEngineWorker: true}, modules);
    const core = getBeaconEngineCore(chain.beaconEngine);
    const pruneSlots = vi.spyOn(core.attestationPool, "prune");
    const pruneEpochs = vi.spyOn(core.seenAttesters, "prune");
    expect(core.clock).not.toBe(clock);
    expect(core.clock.genesisTime).toBe(clock.genesisTime);
    await vi.advanceTimersByTimeAsync((SLOTS_PER_EPOCH + 1) * config.SLOT_DURATION_MS);
    expect(core.clock.currentSlot).toBe(SLOTS_PER_EPOCH + 1);
    expect(core.clock.msFromSlot(SLOTS_PER_EPOCH)).toBe(config.SLOT_DURATION_MS);
    expect(clock.currentSlot).toBe(0);
    expect(core.forkChoice.getTime()).toBe(0);
    expect(pruneSlots).not.toHaveBeenCalled();
    expect(pruneEpochs).not.toHaveBeenCalled();

    clock.setSlot(SLOTS_PER_EPOCH);
    clock.emit(ClockEvent.slot, clock.currentSlot);
    clock.emit(ClockEvent.epoch, clock.currentEpoch);
    expect(core.forkChoice.getTime()).toBe(SLOTS_PER_EPOCH);
    expect(pruneSlots).toHaveBeenCalledExactlyOnceWith(SLOTS_PER_EPOCH);
    expect(pruneEpochs).toHaveBeenCalledExactlyOnceWith(1);
    await vi.advanceTimersByTimeAsync(0);
    await chain.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["close", "failed startup"])("stops the worker-local clock after %s", async (shutdown) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const dependencies = createTestBeaconEngine({...opts, beaconEngineWorker: true}, modules);
    engine = dependencies.beaconEngineCore;
    expect(vi.getTimerCount()).toBe(1);
    if (shutdown === "failed startup") {
      await expect(engine.prepareAnchorState(new Uint8Array())).rejects.toThrow();
    }
    await dependencies.beaconEngine.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])("selects cache sharing with beaconEngineWorker=%s", async (beaconEngineWorker) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const options = {...opts, beaconEngineWorker};
    const dependencies = await initializeTestChain(options, modules);
    chain = new BeaconChain(options, dependencies);
    if (!engine) throw Error("Expected initialized engine");
    expect(chain.blockSerializedCache === engine.blockSerializedCache).toBe(!beaconEngineWorker);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    chain.blockSerializedCache.set(toRootHex(blockRoot), block, bytes);
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    await engine.validateGossipBlock(blockRoot, structuredClone(bytes), ForkName.phase0);
    const cached = engine.blockSerializedCache.get(toRootHex(blockRoot));
    vi.spyOn(engine.forkChoice, "getBlockHexDefaultStatus").mockReturnValue(null);
    await expect(engine.verifyBlocks([{blockRoot, blockBytes: structuredClone(bytes)}], {})).resolves.toMatchObject({
      err: {type: {code: "BLOCK_ERROR_PARENT_BLOCK_UNKNOWN"}},
    });
    expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
    expect(engine.blockSerializedCache.get(toRootHex(blockRoot))).toBe(cached);
    expect(cached?.block === block).toBe(!beaconEngineWorker);

    expect(engine.serializedCache).toBe(beaconEngineWorker ? undefined : chain.serializedCache);
    const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    const exitBytes = ssz.phase0.SignedVoluntaryExit.serialize(exit);
    chain.serializedCache.set(exit, exitBytes);
    const deserializeExit = vi.spyOn(ssz.phase0.SignedVoluntaryExit, "deserialize");
    const validateExit = vi.spyOn(voluntaryExitValidation, "validateGossipVoluntaryExit").mockResolvedValue(undefined);
    expect((await engine.validateGossipVoluntaryExit(exitBytes)).err).toBeNull();
    expect(deserializeExit).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
    expect(validateExit.mock.calls[0][0] === exit).toBe(!beaconEngineWorker);
    expect(chain.serializedCache.getDeserialized(exitBytes)).toBe(beaconEngineWorker ? undefined : exit);
  });

  it.each([false, true])("owns the execution builder with beaconEngineWorker=%s", async (beaconEngineWorker) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.executionBuilderOpts = {
      ...defaultExecutionBuilderOpts,
      enabled: true,
      timeout: 1234,
      userAgent: "test-execution-builder",
    };
    chain = await createBeaconChain({...opts, beaconEngineWorker}, modules);
    const core = getBeaconEngineCore(chain.beaconEngine);
    const builder = core.executionBuilder;
    if (!builder) throw Error("Expected engine-owned execution builder");
    expect(chain).not.toHaveProperty("executionBuilder");
    expect(getClient).toHaveBeenCalledExactlyOnceWith(
      {
        baseUrl: modules.executionBuilderOpts.url,
        globalInit: {timeoutMs: 1234, headers: {"User-Agent": "test-execution-builder"}},
      },
      {config: modules.config, metrics: core.metrics?.builderHttpClient, logger: modules.logger}
    );

    const registration = ssz.bellatrix.SignedValidatorRegistrationV1.defaultValue();
    registration.message.gasLimit = 36_000_000;
    const registrationsBytes = routes.validator.SignedValidatorRegistrationV1ListType.serialize([registration]);
    executionBuilderApi.registerValidator.mockResolvedValue({assertOk: () => {}});
    await chain.beaconEngine.registerValidator(1, registrationsBytes);
    expect(executionBuilderApi.registerValidator).toHaveBeenCalledExactlyOnceWith({registrations: [registration]});
    expect(builder.getValidatorRegistration(registration.message.pubkey)).toEqual({epoch: 1, gasLimit: 36_000_000});

    const error = new Error("Builder registration failed");
    executionBuilderApi.registerValidator.mockRejectedValueOnce(error);
    await expect(
      chain.beaconEngine.registerValidator(
        2,
        routes.validator.SignedValidatorRegistrationV1ListType.serialize([
          {...registration, message: {...registration.message, gasLimit: 40_000_000}},
        ])
      )
    ).rejects.toBe(error);
    expect(builder.getValidatorRegistration(registration.message.pubkey)).toEqual({epoch: 1, gasLimit: 36_000_000});

    const signedBlindedBlock = ssz.electra.SignedBlindedBeaconBlock.defaultValue();
    signedBlindedBlock.message.slot = config.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH;
    const request = {
      data: signedBlindedBlock,
      bytes: ssz.electra.SignedBlindedBeaconBlock.serialize(signedBlindedBlock),
    };
    chain.serializedCache.set(request.data, request.bytes);
    const requestBytes = beaconEngineWorker ? structuredClone(request.bytes) : request.bytes;
    const deserialize = vi.spyOn(ssz.electra.SignedBlindedBeaconBlock, "deserialize");
    const response = ssz.deneb.ExecutionPayloadAndBlobsBundle.defaultValue();
    response.blobsBundle.blobs.push(ssz.deneb.Blob.defaultValue());
    response.blobsBundle.proofs.push(ssz.deneb.KZGProof.defaultValue());
    executionBuilderApi.submitBlindedBlock.mockResolvedValue({value: () => response});
    executionBuilderApi.submitBlindedBlockV2.mockResolvedValue({assertOk: () => {}});

    for (const wireFormat of [WireFormat.ssz, WireFormat.json]) {
      executionBuilderApi.getHeader.mockResolvedValue({
        value: () => ssz.electra.SignedBuilderBid.defaultValue(),
        wireFormat: () => wireFormat,
      });
      await builder.getHeader(
        ForkName.electra,
        signedBlindedBlock.message.slot,
        new Uint8Array(32),
        new Uint8Array(48)
      );
      const contentsBytes = await chain.beaconEngine.submitBlindedBlock(requestBytes, ForkName.electra);
      expect(contentsBytes, `serialized contents using ${wireFormat}`).toBeInstanceOf(Uint8Array);
      const contents = ssz.electra.SignedBlockContents.deserialize(contentsBytes);
      expect(contents, `reconstructed contents using ${wireFormat}`).toMatchObject({
        signedBlock: {
          message: {slot: signedBlindedBlock.message.slot, body: {executionPayload: response.executionPayload}},
          signature: signedBlindedBlock.signature,
        },
        blobs: response.blobsBundle.blobs,
        kzgProofs: response.blobsBundle.proofs,
      });
      expect(executionBuilderApi.submitBlindedBlock, `submission format ${wireFormat}`).toHaveBeenLastCalledWith(
        {signedBlindedBlock: request},
        {retries: 2, requestWireFormat: wireFormat}
      );
      const submitted = executionBuilderApi.submitBlindedBlock.mock.lastCall?.[0].signedBlindedBlock;
      expect(submitted.bytes, `original submission bytes using ${wireFormat}`).toBe(requestBytes);
      expect(submitted.data === signedBlindedBlock, `decoded input reuse using ${wireFormat}`).toBe(
        !beaconEngineWorker
      );
      expect(
        core.serializedCache?.getDeserialized(contentsBytes) !== undefined,
        `decoded output reuse using ${wireFormat}`
      ).toBe(!beaconEngineWorker);
      await expect(
        chain.beaconEngine.submitBlindedBlockNoResponse(requestBytes, ForkName.electra),
        `submission acknowledgement using ${wireFormat}`
      ).resolves.toBeUndefined();
      expect(executionBuilderApi.submitBlindedBlockV2, `submission format ${wireFormat}`).toHaveBeenLastCalledWith(
        {signedBlindedBlock: request},
        {retries: 2, requestWireFormat: wireFormat}
      );
    }
    expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 4 : 0);

    const capellaBlock = ssz.capella.SignedBlindedBeaconBlock.defaultValue();
    capellaBlock.message.slot = config.CAPELLA_FORK_EPOCH * SLOTS_PER_EPOCH;
    const capellaPayload = ssz.capella.ExecutionPayload.defaultValue();
    executionBuilderApi.submitBlindedBlock.mockResolvedValueOnce({value: () => capellaPayload});
    const capellaBytes = await chain.beaconEngine.submitBlindedBlock(
      ssz.capella.SignedBlindedBeaconBlock.serialize(capellaBlock),
      ForkName.capella
    );
    expect(ssz.capella.SignedBeaconBlock.deserialize(capellaBytes).message.body.executionPayload).toEqual(
      capellaPayload
    );

    executionBuilderApi.submitBlindedBlock.mockRejectedValueOnce(error);
    executionBuilderApi.submitBlindedBlockV2.mockRejectedValueOnce(error);
    await expect(chain.beaconEngine.submitBlindedBlock(requestBytes, ForkName.electra)).rejects.toBe(error);
    await expect(chain.beaconEngine.submitBlindedBlockNoResponse(requestBytes, ForkName.electra)).rejects.toBe(error);

    executionBuilderApi.registerValidator.mockClear();
    executionBuilderApi.submitBlindedBlock.mockClear();
    executionBuilderApi.submitBlindedBlockV2.mockClear();
    await expect(chain.beaconEngine.registerValidator(1, Uint8Array.of(1))).rejects.toThrow();
    await expect(chain.beaconEngine.submitBlindedBlock(Uint8Array.of(1), ForkName.electra)).rejects.toThrow();
    await expect(chain.beaconEngine.submitBlindedBlockNoResponse(Uint8Array.of(1), ForkName.fulu)).rejects.toThrow();
    expect(executionBuilderApi.registerValidator).not.toHaveBeenCalled();
    expect(executionBuilderApi.submitBlindedBlock).not.toHaveBeenCalled();
    expect(executionBuilderApi.submitBlindedBlockV2).not.toHaveBeenCalled();
  });

  it.each([undefined, false])("does not construct a disabled execution builder (enabled=%s)", async (enabled) => {
    modules.executionBuilderOpts = enabled === undefined ? undefined : {...defaultExecutionBuilderOpts, enabled};
    chain = await createBeaconChain(opts, modules);
    expect(getBeaconEngineCore(chain.beaconEngine).executionBuilder).toBeUndefined();
    expect(getClient).not.toHaveBeenCalled();
    await expect(chain.beaconEngine.registerValidator(0, new Uint8Array())).rejects.toThrow(
      "External builder not configured"
    );
    const request = ssz.electra.SignedBlindedBeaconBlock.serialize(ssz.electra.SignedBlindedBeaconBlock.defaultValue());
    await expect(chain.beaconEngine.submitBlindedBlock(request, ForkName.electra)).rejects.toThrow(
      "executionBuilder required to publish SignedBlindedBeaconBlock"
    );
    await expect(chain.beaconEngine.submitBlindedBlockNoResponse(request, ForkName.fulu)).rejects.toThrow(
      "executionBuilder required to submit SignedBlindedBeaconBlock to builder"
    );
  });

  it.each([false, true])(
    "wires builder clients and registrations with beaconEngineWorker=%s",
    async (beaconEngineWorker) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
      modules.metrics = metrics;
      modules.builderApiClientOpts = {timeout: 1234, userAgent: "test-builder-client"};
      chain = await createBeaconChain({...opts, beaconEngineWorker}, modules);
      const core = getBeaconEngineCore(chain.beaconEngine);
      const engineBls = vi.spyOn(core.bls, "verifySignatureSets").mockResolvedValue(true);
      const chainBls = vi.spyOn(chain.bls, "verifySignatureSets").mockResolvedValue(true);
      expect(chain.builderApiClient === core.builderApiClient).toBe(!beaconEngineWorker);
      expect(chain.clock === core.clock).toBe(!beaconEngineWorker);

      const preferencesUrl = "https://preferences.builder.example.com";
      const bidUrl = "https://bid.builder.example.com";
      const request = ssz.gloas.BuilderPreferencesRequest.defaultValue();
      request.auth.message.slot = 1;
      request.auth.message.data = new Uint8Array([1]);
      await chain.builderApiClient.submitBuilderPreferences(preferencesUrl, new Uint8Array(48), request);
      await core.builderApiClient.checkStatus();
      await core.builderApiClient.getExecutionPayloadBids(
        [
          {
            url: new TextEncoder().encode(bidUrl),
            auth: request.auth,
            builderPubkeys: [],
            maxExecutionPayment: 0n,
            minBid: 0n,
            builderBoostFactor: 100n,
          },
        ],
        1,
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(48)
      );
      await chain.builderApiClient.submitSignedBeaconBlock(bidUrl, {data: ssz.gloas.SignedBeaconBlock.defaultValue()});
      expect(chainBls).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
      expect(engineBls).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 2);

      const calls = vi.mocked(getClient).mock.calls;
      expect(calls).toHaveLength(beaconEngineWorker ? 4 : 2);
      for (const [clientOpts, clientModules] of calls) {
        expect(clientOpts, "builder client options").toMatchObject({
          globalInit: {timeoutMs: 1234, headers: {"User-Agent": "test-builder-client"}},
        });
        expect([metrics.builderHttpClient, core.metrics?.builderHttpClient], "builder client metric owner").toContain(
          clientModules.metrics
        );
      }
      expect(calls.filter(([, clientModules]) => clientModules.metrics === metrics.builderHttpClient)).toHaveLength(
        beaconEngineWorker ? 2 : 0
      );

      const engineText = await core.metrics?.register.metrics();
      const facadeText = await metrics.register.metrics();
      const preferenceMetric = 'lodestar_builder_api_preferences_forwarded_total{status="success"} 1';
      const blockMetric = 'lodestar_builder_api_block_submissions_total{status="success"} 1';
      expect(engineText).toContain('lodestar_builder_api_status_checks_total{status="success"} 1');
      expect(engineText).toContain("lodestar_builder_api_bid_requests_total 1");
      expect(beaconEngineWorker ? facadeText : engineText).toContain(preferenceMetric);
      expect(beaconEngineWorker ? facadeText : engineText).toContain(blockMetric);
      expect(beaconEngineWorker ? engineText : facadeText).not.toContain(preferenceMetric);
      expect(beaconEngineWorker ? engineText : facadeText).not.toContain(blockMetric);
      await chain.close();
      expect(core.emitter.listenerCount(BeaconEngineEvent.builderRegistered)).toBe(0);
      expect(chain.emitter.listenerCount(ChainEvent.builderRegistered)).toBe(0);
    }
  );

  it("starts with the persisted serving floor and advances it monotonically from engine events", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, {...dependencies, earliestAvailableSlot: 10});
    if (!engine) throw Error("Expected initialized engine");
    expect(chain.earliestAvailableSlot).toBe(10);
    engine.emitter.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 20);
    engine.emitter.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 15);
    expect(chain.earliestAvailableSlot).toBe(20);
    await chain.close();
    engine.emitter.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 30);
    chain.emitter.emit(ChainEvent.earliestAvailableSlotUpdated, 40);
    expect(chain.earliestAvailableSlot).toBe(20);
  });

  it("applies a view update once before downstream chain listeners read the head", async () => {
    const metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.metrics = metrics;
    const dependencies = await initializeTestChain(opts, modules);
    const beaconChain = new BeaconChain(opts, dependencies);
    chain = beaconChain;
    const core = getBeaconEngineCore(beaconChain.beaconEngine);
    const snapshot = core.getChainViewSnapshot();
    const head = {
      ...snapshot.head,
      slot: snapshot.head.slot + 1,
      parentRoot: snapshot.head.blockRoot,
      blockRoot: toRootHex(Buffer.alloc(32, 1)),
    };
    const update = {...snapshot, revision: snapshot.revision + 1, head, blocks: [head]};
    const onUpdate = vi.fn(() => {
      expect(beaconChain.getHead()).toEqual(head);
      expect(toRootHex(beaconChain.getStatus().headRoot)).toBe(head.blockRoot);
    });
    beaconChain.emitter.on(ChainEvent.chainViewUpdated, onUpdate);

    core.emitter.emit(BeaconEngineEvent.chainViewUpdated, structuredClone(update));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(update);
    expect(await metrics.register.getSingleMetricAsString("beacon_head_slot")).toContain(
      `beacon_head_slot ${head.slot}`
    );
    await beaconChain.close();
    core.emitter.emit(BeaconEngineEvent.chainViewUpdated, update);
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("notifies the facade once when fork choice becomes irrecoverable", async () => {
    const shutdown = vi.fn();
    modules.processShutdownCallback = shutdown;
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    if (!engine) throw Error("Expected initialized engine");
    const error = new Error("irrecoverable fork-choice response");
    engine.forkChoice.irrecoverableError = error;
    engine.publishChainView(false);
    engine.publishChainView(false);
    expect(shutdown).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("reads diagnostics on demand without publishing proposer or clock score changes", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    if (!engine) throw Error("Expected initialized engine");
    const nodes = engine.forkChoice.getAllNodes();
    const getAllNodes = vi.spyOn(engine.forkChoice, "getAllNodes");
    const updated = vi.fn();
    engine.emitter.on(BeaconEngineEvent.chainViewUpdated, updated);
    nodes[0].weight = 42n;
    vi.spyOn(engine.forkChoice, "updateAndGetHead").mockReturnValue({head: nodes[0]});
    engine.getProposerHead(0);
    nodes[0].weight = 84n;
    engine.updateTime(1);
    engine.pauseFastConfirmation();
    engine.resumeFastConfirmation();
    expect(getAllNodes).not.toHaveBeenCalled();
    expect(updated).not.toHaveBeenCalled();
    expect(engine.getAllNodes()[0].weight).toBe(84n);
    expect(getAllNodes).toHaveBeenCalledOnce();
  });

  it("owns monitor state and exposes its metrics separately from the facade registry", async () => {
    const metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.metrics = metrics;
    modules.validatorMonitorOpts = {};
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    const beaconEngine = dependencies.beaconEngine;

    expect(chain).not.toHaveProperty("validatorMonitor");
    await beaconEngine.registerLocalValidators([2, 1, 2]);
    await beaconEngine.registerLocalValidatorsInSyncCommittee([{validatorIndex: 1, untilEpoch: 3}]);
    expect(await beaconEngine.getMonitoredValidatorIndices()).toEqual([1, 2]);
    await beaconEngine.registerApiBlock(1, {slot: 0, proposerIndex: 1, blockRoot: toRootHex(stateRoot)});
    const monitorMetrics = await aggregateMetrics([(await beaconEngine.scrapeMetrics()).metrics]);
    expect(monitorMetrics).toContain("validator_monitor_validators 2");
    expect(monitorMetrics).toContain('validator_monitor_beacon_block_total{src="api"} 1');
    expect(metrics.register.getSingleMetric("validator_monitor_validators")).toBeUndefined();
  });

  it.each([false, true])("isolates engine metrics with beaconEngineWorker=%s", async (beaconEngineWorker) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.metrics = metrics;
    chain = await createBeaconChain({...opts, beaconEngineWorker}, modules);
    const core = getBeaconEngineCore(chain.beaconEngine);
    expect(core.metrics?.register).not.toBe(metrics.register);
    const getHeadState = vi.spyOn(core, "getHeadState");
    core.opPool.insertVoluntaryExit(ssz.phase0.SignedVoluntaryExit.defaultValue());

    const mainText = await metrics.register.metrics();
    expect(getHeadState).not.toHaveBeenCalled();
    expect(mainText).not.toContain("lodestar_oppool_voluntary_exit_pool_size");
    const scraped = await chain.beaconEngine.scrapeMetrics();
    expect(structuredClone(scraped)).toEqual(scraped);
    expect(await aggregateMetrics([scraped.metrics])).toContain("lodestar_oppool_voluntary_exit_pool_size 1\n");
    expect(getHeadState).toHaveBeenCalledOnce();
    const poolSize = scraped.metrics.find((metric) => metric.name === "lodestar_oppool_voluntary_exit_pool_size");
    if (!poolSize) throw Error("Missing pool size metric");
    poolSize.values[0].value = 99;
    expect(await aggregateMetrics([(await chain.beaconEngine.scrapeMetrics()).metrics])).toContain(
      "lodestar_oppool_voluntary_exit_pool_size 1\n"
    );

    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const root = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    chain.blockSerializedCache.set(root, block, bytes);
    core.blockSerializedCache.getOrDeserialize(root, bytes);
    const shared = await aggregateMetrics([
      (await chain.beaconEngine.scrapeMetrics()).metrics,
      await metrics.register.getMetricsAsJSON(),
    ]);
    const owners = beaconEngineWorker ? ["chain", "engine"] : ["shared"];
    for (const owner of owners) {
      expect(shared, `cache size for ${owner}`).toContain(`lodestar_block_cache_entries{owner="${owner}"} 1\n`);
      expect(shared, `insertions for ${owner}`).toContain(
        `lodestar_block_cache_insertions_total{owner="${owner}"} 1\n`
      );
    }
    expect(shared.match(/^lodestar_block_cache_entries\{/gm)).toHaveLength(owners.length);

    await chain.close();
    expect(await chain.beaconEngine.scrapeMetrics()).toEqual({metrics: [], extra: ""});
    expect(metrics.register.getSingleMetric("beacon_head_slot")).toBeDefined();
  });

  it("collects pending-state counts inside the engine", async () => {
    const electraConfig = getConfig(ForkName.electra);
    const state = ssz.electra.BeaconState.deserializeToViewDU(
      initDevState(electraConfig, 16, {genesisTime: 0}).serialize()
    );
    state.pendingDeposits.push(ssz.electra.PendingDeposit.defaultViewDU());
    state.pendingPartialWithdrawals.push(ssz.electra.PendingPartialWithdrawal.defaultViewDU());
    state.pendingConsolidations.push(ssz.electra.PendingConsolidation.defaultViewDU());
    state.commit();
    modules.config = createBeaconConfig(electraConfig, state.genesisValidatorsRoot);
    modules.anchorStateBytes = state.serialize();
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    chain = await createBeaconChain(opts, modules);
    const text = await aggregateMetrics([(await chain.beaconEngine.scrapeMetrics()).metrics]);
    for (const name of [
      "beacon_pending_deposits",
      "beacon_pending_partial_withdrawals",
      "beacon_pending_consolidations",
    ]) {
      expect(text, name).toContain(`${name} 1\n`);
      expect(modules.metrics.register.getSingleMetric(name), name).toBeUndefined();
    }
  });

  it("does not create engine registries when metrics are disabled", async () => {
    chain = await createBeaconChain(opts, modules);
    expect(getBeaconEngineCore(chain.beaconEngine).metrics).toBeNull();
    expect(await chain.beaconEngine.scrapeMetrics()).toEqual({metrics: [], extra: ""});
  });

  it("collects historical worker metrics in the engine scrape and propagates failures", async () => {
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    const historicalMetrics =
      "# HELP historical_test Historical metrics\n# TYPE historical_test gauge\nhistorical_test 3\n";
    vi.spyOn(HistoricalStateRegen, "init").mockResolvedValue(HistoricalStateRegen.prototype);
    const scrapeHistorical = vi
      .spyOn(HistoricalStateRegen.prototype, "scrapeMetrics")
      .mockResolvedValue(historicalMetrics);
    vi.spyOn(HistoricalStateRegen.prototype, "close").mockResolvedValue();
    chain = await createBeaconChain({...opts, serveHistoricalState: true}, modules);
    await chain.beaconEngine.loadHistoricalStateRegen();
    expect((await chain.beaconEngine.scrapeMetrics()).extra).toBe(historicalMetrics);
    expect(scrapeHistorical).toHaveBeenCalledOnce();

    const error = Error("historical scrape failed");
    scrapeHistorical.mockRejectedValueOnce(error);
    await expect(chain.beaconEngine.scrapeMetrics()).rejects.toBe(error);
  });

  it("initializes and collects native metrics inside the engine before runtime startup", async () => {
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    const dependencies = createTestBeaconEngine({...opts, nativeStateTransition: true}, modules);
    engine = dependencies.beaconEngineCore;
    const scraped = await dependencies.beaconEngine.scrapeMetrics();
    expect(engine.metrics?.stateTransition).toBeNull();
    expect(scraped.metrics.some((metric) => metric.name === "lodestar_stfn_process_block_seconds")).toBe(false);
    expect(scraped.extra).toContain("# TYPE lodestar_stfn_process_block_seconds histogram");
  });

  it("runs epoch monitoring on forwarded ticks and cancels it on close", async () => {
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.validatorMonitorOpts = {};
    const dependencies = await initializeTestChain(opts, modules);
    const beaconEngine = getBeaconEngineCore(dependencies.beaconEngine);
    if (!beaconEngine.validatorMonitor) throw new Error("Missing monitor");
    const monitorEpoch = vi.spyOn(beaconEngine.validatorMonitor, "onceEveryEndOfEpoch").mockImplementation(() => {});
    vi.useFakeTimers();
    const halfSlot = config.SLOT_DURATION_MS / 2;

    dependencies.beaconEngine.onSlot(SLOTS_PER_EPOCH - 1);
    await vi.advanceTimersByTimeAsync(halfSlot - 1);
    expect(monitorEpoch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(monitorEpoch).toHaveBeenCalledExactlyOnceWith(beaconEngine.getHeadState());

    dependencies.beaconEngine.onSlot(2 * SLOTS_PER_EPOCH - 1);
    expect(vi.getTimerCount()).toBe(1);
    await dependencies.beaconEngine.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(halfSlot);
    expect(monitorEpoch).toHaveBeenCalledOnce();
  });

  it("supports logging without metrics and retains the epoch metrics guard", async () => {
    modules.validatorMonitorOpts = {validatorMonitorLogs: true};
    const dependencies = await initializeTestChain(opts, modules);
    const beaconEngine = getBeaconEngineCore(dependencies.beaconEngine);
    if (!beaconEngine.validatorMonitor) throw new Error("Missing monitor");
    const monitorEpoch = vi.spyOn(beaconEngine.validatorMonitor, "onceEveryEndOfEpoch");
    await beaconEngine.registerLocalValidators([1]);
    expect(await beaconEngine.getMonitoredValidatorIndices()).toEqual([1]);
    expect(await beaconEngine.scrapeMetrics()).toEqual({metrics: [], extra: ""});
    vi.useFakeTimers();
    dependencies.beaconEngine.onSlot(SLOTS_PER_EPOCH - 1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(monitorEpoch).not.toHaveBeenCalled();
  });

  it("keeps monitor bridges inactive when monitoring is disabled", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    await dependencies.beaconEngine.registerLocalValidators([1]);
    expect(await dependencies.beaconEngine.getMonitoredValidatorIndices()).toEqual([]);
    expect(await dependencies.beaconEngine.scrapeMetrics()).toEqual({metrics: [], extra: ""});
  });

  it("forwards engine payload imports to SSE only for recent payloads", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    const imported = vi.fn();
    chain.emitter.on(routes.events.EventType.executionPayload, imported);
    const event = {
      slot: 0,
      blockRoot: toRootHex(Buffer.alloc(32)),
      blockHash: toRootHex(Buffer.alloc(32)),
      builderIndex: 0,
      executionOptimistic: false,
    };
    getBeaconEngineCore(chain.beaconEngine).emitter.emit(BeaconEngineEvent.executionPayloadImported, event);
    expect(imported).toHaveBeenCalledExactlyOnceWith(event);
    getBeaconEngineCore(chain.beaconEngine).emitter.emit(BeaconEngineEvent.executionPayloadImported, {
      ...event,
      slot: -64,
    });
    expect(imported).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "forwards fast confirmation from fork choice with finalized anchor=%s",
    async (isFinalized) => {
      const state = stateTransition
        .createBeaconStateView({
          config: modules.config,
          stateBytes: modules.anchorStateBytes,
          nativeStateTransition: false,
        })
        .processSlots(1);
      clock.setSlot(1);
      const options = {...opts, fastConfirmation: true};
      const dependencies = await initializeTestChain(options, {
        ...modules,
        anchorStateBytes: state.serialize(),
        isAnchorStateFinalized: isFinalized,
      });
      chain = new BeaconChain(options, dependencies);
      const core = getBeaconEngineCore(chain.beaconEngine);
      const notification = vi.fn();
      const publicEvent = vi.fn();
      core.emitter.on(BeaconEngineEvent.fastConfirmation, notification);
      chain.emitter.on(routes.events.EventType.fastConfirmation, publicEvent);

      chain.beaconEngine.pauseFastConfirmation();

      const finalized = core.forkChoice.getFinalizedBlock();
      const expected = {block: finalized.blockRoot, slot: finalized.slot, currentSlot: 1};
      expect(notification).toHaveBeenCalledExactlyOnceWith(expected);
      expect(publicEvent).toHaveBeenCalledExactlyOnceWith(expected);
    }
  );

  it.each([true, false])("publishes a locally produced slashing only after successful validation=%s", async (valid) => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    const core = getBeaconEngineCore(chain.beaconEngine);
    const validation = defer<Uint8Array>();
    const validate = vi
      .spyOn(proposerSlashingValidation, "validateApiProposerSlashing")
      .mockReturnValue(validation.promise);
    const debug = vi.spyOn(modules.logger, LogLevel.debug);
    for (const value of [1, 2]) {
      const header = ssz.phase0.SignedBeaconBlockHeader.defaultValue();
      header.message.slot = 1;
      header.message.bodyRoot.fill(value);
      core.seenBlockProposers.observeBlockRoot(
        1,
        0,
        toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header.message)),
        header
      );
    }
    const notification = vi.fn();
    const publicEvent = vi.fn();
    const publish = vi.fn(() => expect(core.opPool.hasSeenProposerSlashing(0)).toBe(true));
    core.emitter.on(BeaconEngineEvent.proposerSlashingProduced, notification);
    chain.emitter.on(routes.events.EventType.proposerSlashing, publicEvent);
    chain.emitter.on(ChainEvent.publishProposerSlashing, publish);

    chain.processProposerEquivocation(1, 0);
    chain.processProposerEquivocation(1, 0);
    expect(validate).toHaveBeenCalledOnce();
    expect(notification).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    if (valid) {
      validation.resolve(Buffer.alloc(32));
      await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
      const slashing = validate.mock.calls[0][0];
      expect(notification).toHaveBeenCalledExactlyOnceWith(slashing);
      expect(publicEvent).toHaveBeenCalledExactlyOnceWith(slashing);
    } else {
      const error = Error("invalid slashing");
      validation.reject(error);
      await vi.waitFor(() =>
        expect(debug).toHaveBeenCalledWith(
          "Produced proposer slashing is not valid",
          {slot: 1, proposerIndex: 0},
          error
        )
      );
      expect(notification).not.toHaveBeenCalled();
      expect(publicEvent).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    }
  });

  it("owns a bounded signature cache independent of the facade cache", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    const {seenBlockInputCache} = chain;
    const beaconEngine = getBeaconEngineCore(chain.beaconEngine);
    const root = toRootHex(Buffer.alloc(32));
    const signature = Buffer.alloc(96, 1);
    expect(beaconEngine.isVerifiedProposerSignature(root, signature)).toBe(false);
    beaconEngine.markVerifiedProposerSignature(root, signature);
    expect(beaconEngine.isVerifiedProposerSignature(root, Buffer.alloc(96, 1))).toBe(true);
    expect(beaconEngine.isVerifiedProposerSignature(root, Buffer.alloc(96, 2))).toBe(false);
    expect(seenBlockInputCache.isVerifiedProposerSignature(0, root, signature)).toBe(false);
    signature.fill(2);
    expect(beaconEngine.isVerifiedProposerSignature(root, signature)).toBe(false);
    expect(beaconEngine.isVerifiedProposerSignature(root, Buffer.alloc(96, 1))).toBe(true);
    for (let i = 1; i <= 3 * SLOTS_PER_EPOCH; i++) {
      const bytes = Buffer.alloc(32);
      bytes.writeUInt32LE(i);
      const nextRoot = toRootHex(bytes);
      beaconEngine.markVerifiedProposerSignature(nextRoot, signature);
      expect(beaconEngine.isVerifiedProposerSignature(nextRoot, signature), `signature for root ${i}`).toBe(true);
    }
    expect(beaconEngine.isVerifiedProposerSignature(root, Buffer.alloc(96, 1))).toBe(false);
  });

  it("constructs once, validates before writing, and logs before starting runtime", async () => {
    const createView = vi.spyOn(stateTransition, "createBeaconStateView");
    const putState = vi.spyOn(db.stateArchive, "putBinary");
    const order: string[] = [];
    modules.stateInitialization = {
      shouldPersist: true,
      validate(anchor) {
        order.push("validate");
        expect(structuredClone(anchor)).toEqual(anchor);
        expect(anchor.stateRoot).toEqual(stateRoot);
        expect(putState).not.toHaveBeenCalled();
        expect(engine?.forkChoice).toBeUndefined();
        expect(clock.listenerCount(ClockEvent.epoch)).toBe(0);
      },
      log() {
        order.push("log");
        expect(putState).toHaveBeenCalledExactlyOnceWith(0, modules.anchorStateBytes);
        expect(engine?.forkChoice).toBeUndefined();
      },
    };
    const dependencies = await initializeTestChain(opts, modules);
    expect(clock.listenerCount(ClockEvent.epoch)).toBe(0);
    chain = new BeaconChain(opts, dependencies);
    expect(clock.listenerCount(ClockEvent.epoch)).toBe(1);
    await chain.init();
    expect(order).toEqual(["validate", "log"]);
    expect(createView).toHaveBeenCalledTimes(1);
    expect(Buffer.from((await db.stateArchive.getBinary(0)) ?? []).equals(modules.anchorStateBytes)).toBe(true);
    expect(await db.blockArchive.keys()).toEqual([0]);
    expect(await db.block.keys()).toHaveLength(1);
    expect(engine?.getHeadState().hashTreeRoot()).toEqual(stateRoot);
    await expect(engine?.initializeFromAnchor()).rejects.toMatchObject({type: {code: "BEACON_ENGINE_STARTUP_PHASE"}});
  });

  it("closes preparation without writing or starting runtime when validation fails", async () => {
    const error = new Error("checkpoint mismatch");
    const prune = vi.spyOn(db, "pruneHotDb");
    modules.pruneHotDbOnInit = true;
    const log = vi.fn();
    const initialize = vi.spyOn(BeaconEngineCore.prototype, "initializeFromAnchor");
    modules.stateInitialization = {
      shouldPersist: true,
      validate() {
        throw error;
      },
      log,
    };
    await expect(createBeaconChain(opts, modules)).rejects.toBe(error);
    expect(initialize).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(await db.stateArchive.keys()).toEqual([]);
    expect(await db.blockArchive.keys()).toEqual([]);
    await expect(engine?.prepareAnchorState(modules.anchorStateBytes)).rejects.toMatchObject({
      type: {code: "BEACON_ENGINE_STARTUP_PHASE"},
    });
  });

  it("does not log success or initialize runtime after a failed persistence write", async () => {
    const error = new Error("disk write failed");
    vi.spyOn(db.stateArchive, "putBinary").mockRejectedValue(error);
    const log = vi.fn();
    const initialize = vi.spyOn(BeaconEngineCore.prototype, "initializeFromAnchor");
    modules.stateInitialization = {shouldPersist: true, validate() {}, log};
    await expect(createBeaconChain(opts, modules)).rejects.toBe(error);
    expect(log).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    await expect(engine?.persistAnchorState()).rejects.toMatchObject({type: {code: "BEACON_ENGINE_STARTUP_PHASE"}});
  });

  it("keeps returned summary mutations separate from the retained state and skips persistence", async () => {
    modules.stateInitialization = {
      shouldPersist: false,
      validate(anchor: AnchorSummary) {
        anchor.stateRoot.fill(42);
        anchor.fork.currentVersion.fill(42);
        anchor.checkpoint.root.fill(42);
      },
      log() {},
    };
    chain = await createBeaconChain(opts, modules);
    expect(engine?.getHeadState().hashTreeRoot()).toEqual(stateRoot);
    expect(await db.stateArchive.keys()).toEqual([]);
    await chain.close();
    expect(clock.listenerCount(ClockEvent.slot)).toBe(0);
  });
  it("returns plain Gloas bootstrap data and seeds independent engine and facade anchor inputs", async () => {
    const gloasConfig = getConfig(ForkName.gloas);
    const state = initDevState(gloasConfig, 16, {genesisTime: 0});
    state.slot = 1;
    state.latestBlockHeader.slot = 1;
    state.commit();
    modules.config = createBeaconConfig(gloasConfig, state.genesisValidatorsRoot);
    modules.anchorStateBytes = state.serialize();
    modules.isAnchorStateFinalized = false;
    modules.clock = new ClockStopped(1);
    let bootstrap: EngineBootstrap | undefined;
    const initialize = BeaconEngineCore.prototype.initializeFromAnchor;
    vi.spyOn(BeaconEngineCore.prototype, "initializeFromAnchor").mockImplementation(async function (
      this: BeaconEngineCore
    ) {
      bootstrap = await initialize.call(this);
      expect(structuredClone(bootstrap)).toEqual(bootstrap);
      return bootstrap;
    });
    chain = await createBeaconChain(opts, modules);
    if (!bootstrap?.gloasAnchor) throw new Error("Missing Gloas anchor");
    expect(chain.seenPayloadEnvelopeInputCache.get(toRootHex(bootstrap.checkpoint.root))?.getBid()).toEqual(
      bootstrap.gloasAnchor.bid
    );
    const engineInput = engine?.seenPayloadEnvelopeInputCache.get(toRootHex(bootstrap.checkpoint.root));
    expect(engineInput?.getBid()).toEqual(bootstrap.gloasAnchor.bid);
    expect(engineInput?.getBid()).not.toBe(bootstrap.gloasAnchor.bid);
    expect(engineInput).not.toBe(chain.seenPayloadEnvelopeInputCache.get(toRootHex(bootstrap.checkpoint.root)));
    expect(engineInput).not.toHaveProperty("columnsCache");
    bootstrap.finalizedCheckpoint.root.fill(42);
    const cached = engine?.blockStateCache.get(toRootHex(bootstrap.stateRoot));
    expect(cached).toBeDefined();
    expect(cached?.finalizedCheckpoint.root).toEqual(state.finalizedCheckpoint.root);
  });
});
