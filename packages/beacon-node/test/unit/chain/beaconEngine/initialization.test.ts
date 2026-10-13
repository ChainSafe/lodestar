import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import * as stateTransition from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineEvent} from "../../../../src/chain/beaconEngine/events.js";
import {AnchorSummary, EngineBootstrap} from "../../../../src/chain/beaconEngine/initialization.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import * as blockValidation from "../../../../src/chain/validation/block.js";
import * as voluntaryExitValidation from "../../../../src/chain/validation/voluntaryExit.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {createMetrics} from "../../../../src/metrics/index.js";
import {initDevState} from "../../../../src/node/utils/state.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {TestChainModules, createBeaconChain, initializeTestChain} from "../../../utils/chain.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";

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
  let engine: BeaconEngine | undefined;
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
    const prepare = BeaconEngine.prototype.prepareAnchorState;
    vi.spyOn(BeaconEngine.prototype, "prepareAnchorState").mockImplementation(function (this: BeaconEngine, bytes) {
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

  it.each([false, true])("selects cache sharing with beaconEngineWorker=%s", async (beaconEngineWorker) => {
    const options = {...opts, beaconEngineWorker};
    const dependencies = await initializeTestChain(options, modules);
    chain = new BeaconChain(options, dependencies);
    if (!engine) throw Error("Expected initialized engine");
    expect(chain.blockCache === engine.blockCache).toBe(!beaconEngineWorker);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    chain.blockCache.set(toRootHex(blockRoot), block, bytes);
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    vi.spyOn(blockValidation, "validateGossipBlock").mockResolvedValue({skippedSlots: 0});
    await engine.validateGossipBlock(blockRoot, structuredClone(bytes), ForkName.phase0);
    const cached = engine.blockCache.get(toRootHex(blockRoot));
    vi.spyOn(engine.forkChoice, "getBlockHexDefaultStatus").mockReturnValue(null);
    await expect(
      engine.verifyBlocks([{blockRoot, blockBytes: structuredClone(bytes)}], {}, new AbortController().signal)
    ).rejects.toMatchObject({
      type: {code: "BLOCK_ERROR_PARENT_BLOCK_UNKNOWN"},
    });
    expect(deserialize).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
    expect(engine.blockCache.get(toRootHex(blockRoot))).toBe(cached);
    expect(cached?.block === block).toBe(!beaconEngineWorker);

    expect(engine.serializedCache).toBe(beaconEngineWorker ? undefined : chain.serializedCache);
    const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    const exitBytes = ssz.phase0.SignedVoluntaryExit.serialize(exit);
    chain.serializedCache.set(exit, exitBytes);
    const deserializeExit = vi.spyOn(ssz.phase0.SignedVoluntaryExit, "deserialize");
    const validateExit = vi.spyOn(voluntaryExitValidation, "validateGossipVoluntaryExit").mockResolvedValue(undefined);
    expect((await engine.validateGossipVoluntaryExit(exitBytes)).status).toBe("accept");
    expect(deserializeExit).toHaveBeenCalledTimes(beaconEngineWorker ? 1 : 0);
    expect(validateExit.mock.calls[0][0] === exit).toBe(!beaconEngineWorker);
    expect(chain.serializedCache.getDeserialized(exitBytes)).toBe(beaconEngineWorker ? undefined : exit);
  });

  it("starts with the persisted serving floor and advances it monotonically from engine events", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, {...dependencies, earliestAvailableSlot: 10});
    if (!engine) throw Error("Expected initialized engine");
    expect(chain.earliestAvailableSlot).toBe(10);
    engine.events.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 20);
    engine.events.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 15);
    expect(chain.earliestAvailableSlot).toBe(20);
    await chain.close();
    engine.events.emit(BeaconEngineEvent.earliestAvailableSlotUpdated, 30);
    expect(chain.earliestAvailableSlot).toBe(20);
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
    engine.events.on(BeaconEngineEvent.chainViewUpdated, updated);
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
    const monitorMetrics = await beaconEngine.scrapeValidatorMonitorMetrics();
    expect(monitorMetrics).toContain("validator_monitor_validators 2");
    expect(monitorMetrics).toContain('validator_monitor_beacon_block_total{src="api"} 1');
    expect(metrics.register.getSingleMetric("validator_monitor_validators")).toBeUndefined();
  });

  it.each(["abort", "close"])("runs epoch monitoring on the engine clock and cancels it on %s", async (shutdown) => {
    modules.metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    modules.validatorMonitorOpts = {};
    const dependencies = await initializeTestChain(opts, modules);
    const beaconEngine = dependencies.beaconEngine;
    if (!(beaconEngine instanceof BeaconEngine) || !beaconEngine.validatorMonitor) throw new Error("Missing monitor");
    const monitorEpoch = vi.spyOn(beaconEngine.validatorMonitor, "onceEveryEndOfEpoch").mockImplementation(() => {});
    vi.useFakeTimers();
    const halfSlot = config.SLOT_DURATION_MS / 2;

    clock.emit(ClockEvent.slot, SLOTS_PER_EPOCH - 1);
    await vi.advanceTimersByTimeAsync(halfSlot - 1);
    expect(monitorEpoch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(monitorEpoch).toHaveBeenCalledExactlyOnceWith(beaconEngine.getHeadState());

    clock.emit(ClockEvent.slot, 2 * SLOTS_PER_EPOCH - 1);
    expect(vi.getTimerCount()).toBe(1);
    if (shutdown === "abort") dependencies.abortController.abort();
    else await beaconEngine.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(halfSlot);
    expect(monitorEpoch).toHaveBeenCalledOnce();
  });

  it("supports logging without metrics and retains the epoch metrics guard", async () => {
    modules.validatorMonitorOpts = {validatorMonitorLogs: true};
    const dependencies = await initializeTestChain(opts, modules);
    const beaconEngine = dependencies.beaconEngine;
    if (!(beaconEngine instanceof BeaconEngine) || !beaconEngine.validatorMonitor) throw new Error("Missing monitor");
    const monitorEpoch = vi.spyOn(beaconEngine.validatorMonitor, "onceEveryEndOfEpoch");
    await beaconEngine.registerLocalValidators([1]);
    expect(await beaconEngine.getMonitoredValidatorIndices()).toEqual([1]);
    expect(await beaconEngine.scrapeValidatorMonitorMetrics()).toBe("");
    vi.useFakeTimers();
    clock.emit(ClockEvent.slot, SLOTS_PER_EPOCH - 1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS);
    expect(monitorEpoch).not.toHaveBeenCalled();
  });

  it("keeps monitor bridges inactive when monitoring is disabled", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    await dependencies.beaconEngine.registerLocalValidators([1]);
    expect(await dependencies.beaconEngine.getMonitoredValidatorIndices()).toEqual([]);
    expect(await dependencies.beaconEngine.scrapeValidatorMonitorMetrics()).toBe("");
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
    chain.beaconEngine.events.emit(BeaconEngineEvent.executionPayloadImported, event);
    expect(imported).toHaveBeenCalledExactlyOnceWith(event);
    chain.beaconEngine.events.emit(BeaconEngineEvent.executionPayloadImported, {...event, slot: -64});
    expect(imported).toHaveBeenCalledOnce();
  });

  it("owns a bounded signature cache independent of the facade cache", async () => {
    const dependencies = await initializeTestChain(opts, modules);
    chain = new BeaconChain(opts, dependencies);
    const {beaconEngine, seenBlockInputCache} = chain;
    if (!(beaconEngine instanceof BeaconEngine)) throw new Error("Expected a local BeaconEngine");
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
    expect(clock.listenerCount(ClockEvent.epoch)).toBeGreaterThan(0);
    chain = new BeaconChain(opts, dependencies);
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
    const initialize = vi.spyOn(BeaconEngine.prototype, "initializeFromAnchor");
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
    const initialize = vi.spyOn(BeaconEngine.prototype, "initializeFromAnchor");
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
    expect(clock.listenerCount(ClockEvent.slot)).toBe(1);
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
    const initialize = BeaconEngine.prototype.initializeFromAnchor;
    vi.spyOn(BeaconEngine.prototype, "initializeFromAnchor").mockImplementation(async function (this: BeaconEngine) {
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
