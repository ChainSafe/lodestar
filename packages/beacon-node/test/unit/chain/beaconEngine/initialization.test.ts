import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import * as stateTransition from "@lodestar/state-transition";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {AnchorSummary, EngineBootstrap} from "../../../../src/chain/beaconEngine/initialization.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import {BeaconDb} from "../../../../src/db/index.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
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
      validatorMonitor: null,
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
    vi.restoreAllMocks();
    await closeDb();
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
  it("returns plain Gloas bootstrap data and seeds the facade anchor bid", async () => {
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
    bootstrap.finalizedCheckpoint.root.fill(42);
    const cached = engine?.blockStateCache.get(toRootHex(bootstrap.stateRoot));
    expect(cached).toBeDefined();
    expect(cached?.finalizedCheckpoint.root).toEqual(state.finalizedCheckpoint.root);
  });
});
