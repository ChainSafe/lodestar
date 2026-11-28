import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import bindings from "@lodestar/native";
import {SecretKey} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {StateRegenerator as NativeRegeneratorBinding} from "@lodestar/native/regen";
import {ForkName} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  IBeaconStateViewNative,
  NativeBeaconStateView,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {ErrorAborted, toRootHex} from "@lodestar/utils";
import {BlockInputColumns} from "../../../../src/chain/blocks/blockInput/blockInput.js";
import {BlockInputSource} from "../../../../src/chain/blocks/blockInput/types.js";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {initializeForkChoice} from "../../../../src/chain/forkChoice/index.js";
import {IChainOptions, defaultChainOptions} from "../../../../src/chain/options.js";
import {IStateRegeneratorInternal, RegenCaller} from "../../../../src/chain/regen/interface.js";
import {NativeStateRegenerator} from "../../../../src/chain/regen/native.js";
import {NativeRegenerator} from "../../../../src/chain/regen/nativeRegenerator.js";
import {QueuedStateRegenerator} from "../../../../src/chain/regen/queued.js";
import {StateRegenerator} from "../../../../src/chain/regen/regen.js";
import {NativeBlockStateCache} from "../../../../src/chain/stateCache/nativeBlockStateCache.js";
import {NativeCheckpointStateCache} from "../../../../src/chain/stateCache/nativeCheckpointStateCache.js";
import {getBinding} from "../../../../src/chain/stateCache/nativeStateCacheUtils.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/index.js";
import {IClock} from "../../../../src/util/clock.js";
import {getMockedBeaconDb} from "../../../mocks/mockedBeaconDb.js";
import {ClockStatic} from "../../../utils/clock.js";

const cleanups: (() => void | Promise<void>)[] = [];
const logger = testLogger();
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fixture(slotOffset = 31, maxBlockStates = 64, clock?: IClock, maxCheckpointEpochs = 2) {
  const dir = mkdtempSync(join(tmpdir(), "lodestar-native-regen-adapter-"));
  cleanups.push(() => rmSync(dir, {recursive: true, force: true}));
  const controller = new AbortController();
  cleanups.push(() => controller.abort());
  const config = createBeaconConfig(stfConfig, new Uint8Array(32));
  pubkeyCache.ensureCapacity(16);
  const anchor = new NativeBeaconStateView(
    config,
    bindings.BeaconStateView.createFromBytes(
      ssz.fulu.BeaconState.serialize(createStfState(slotOffset)),
      new bindings.BeaconConfig(stfConfig, new Uint8Array(32))
    ) as IBeaconStateViewNative
  );
  cleanups.push(() => anchor.release());
  const blockStateCache = new NativeBlockStateCache(
    {config, anchorState: anchor, signal: controller.signal},
    {maxBlockStates}
  );
  cleanups.push(() => blockStateCache.close());
  const checkpointStateCache = new NativeCheckpointStateCache(
    {config, blockStateCache, dataDir: dir, logger, signal: controller.signal, clock},
    {maxCPStateEpochsInMemory: maxCheckpointEpochs}
  );
  cleanups.push(() => checkpointStateCache.close());
  blockStateCache.add(anchor);
  blockStateCache.setHeadState(anchor);
  const {checkpoint} = anchor.computeAnchorCheckpoint();
  checkpointStateCache.add(checkpoint, anchor);
  const emitter = new ChainEventEmitter();
  const forkChoice = initializeForkChoice(
    config,
    emitter,
    anchor.slot,
    anchor,
    true,
    {nativeForkChoice: true},
    () => anchor.getEffectiveBalanceIncrementsZeroInactive(),
    ({stateRoot, checkpoint: cp}) =>
      stateRoot
        ? blockStateCache.get(stateRoot)
        : cp
          ? checkpointStateCache.get({epoch: cp.epoch, rootHex: cp.rootHex})
          : null,
    null,
    logger
  );
  const modules = {
    config,
    forkChoice,
    emitter,
    logger,
    signal: controller.signal,
    blockStateCache,
    checkpointStateCache,
    metrics: null,
    validatorMonitor: null,
  };
  const native = new NativeStateRegenerator(modules);
  cleanups.push(() => native.close());
  const queue = new QueuedStateRegenerator(native, modules);
  return {anchor, blockStateCache, checkpointStateCache, native, queue, forkChoice, emitter, controller};
}

it("reuses resident JS block views and their memoized properties across regen APIs", async () => {
  const {anchor, blockStateCache, native, queue, forkChoice} = fixture(0);
  await queue.init();
  const root = toRootHex(anchor.hashTreeRoot());
  const balances = anchor.getAllBalances();
  const nativeGet = vi.spyOn(NativeRegeneratorBinding.prototype, "getState");
  const cacheGet = vi.spyOn(blockStateCache.binding, "get");
  const block = ssz.fulu.BeaconBlock.defaultValue();
  block.parentRoot = anchor.computeAnchorCheckpoint().checkpoint.root;
  block.slot = anchor.slot + 1;
  const states = [
    await native.getState(root, RegenCaller.restApi),
    await native.getPreState(block, {dontTransferCache: true}, RegenCaller.processBlock),
    await native.getBlockSlotState(forkChoice.getHead(), anchor.slot, {dontTransferCache: true}, RegenCaller.restApi),
    await queue.getState(root, RegenCaller.restApi),
    queue.getPreStateSync(block),
    blockStateCache.getSeedState(),
    ...blockStateCache.getStates(),
  ];
  for (const [index, state] of states.entries()) {
    expect(state, `wrapper at index ${index}`).toBe(anchor);
    expect(state?.getAllBalances(), `memoized balances at index ${index}`).toBe(balances);
  }
  expect(nativeGet).not.toHaveBeenCalled();
  expect(cacheGet).not.toHaveBeenCalled();
});

it.each(["get", "getSeedState", "getStates"] as const)(
  "%s falls back for a native-only block state and then reuses its JS wrapper",
  (method) => {
    const {anchor, blockStateCache} = fixture(0);
    const state = anchor.processSlots(anchor.slot + 1, {dontTransferCache: true});
    cleanups.push(() => state.release());
    const root = toRootHex(state.hashTreeRoot());
    blockStateCache.clear();
    blockStateCache.binding.add(getBinding(state));
    blockStateCache.syncCache();
    const nativeRead = vi.spyOn(blockStateCache.binding, "get");
    const read = () =>
      method === "get"
        ? blockStateCache.get(root)
        : method === "getSeedState"
          ? blockStateCache.getSeedState()
          : Array.from(blockStateCache.getStates())[0];
    const restored = read();
    if (!restored) throw Error("Missing native block state");
    cleanups.push(() => restored.release());
    expect(restored).not.toBe(state);
    expect(restored.hashTreeRoot()).toEqual(state.hashTreeRoot());
    const balances = restored.getAllBalances();
    expect(read()).toBe(restored);
    expect(blockStateCache.get(root)?.getAllBalances()).toBe(balances);
    expect(nativeRead).toHaveBeenCalledOnce();

    blockStateCache.binding.clear();
    blockStateCache.syncCache();
    expect(blockStateCache.get(root)).toBeNull();
    expect(Array.from(blockStateCache.getStates())).toHaveLength(0);
    expect(restored.hashTreeRoot()).toEqual(state.hashTreeRoot());
  }
);

it("reuses resident JS checkpoint views through reads, reloads, and replacement", async () => {
  const {anchor, checkpointStateCache, native, queue, forkChoice} = fixture(0);
  await queue.init();
  const state = anchor.processSlots(anchor.slot + 32, {dontTransferCache: true});
  cleanups.push(() => state.release());
  const cp = state.computeAnchorCheckpoint().checkpoint;
  const cpHex = {epoch: cp.epoch, rootHex: toRootHex(cp.root)};
  checkpointStateCache.add(cp, state);
  expect(checkpointStateCache.updatePreComputedCheckpoint(cpHex.rootHex, cp.epoch)).toBeNull();
  const balances = state.getAllBalances();
  const block = ssz.fulu.BeaconBlock.defaultValue();
  block.parentRoot = cp.root;
  block.slot = state.slot;
  const states = [
    checkpointStateCache.get(cpHex),
    checkpointStateCache.getLatest(cpHex.rootHex, cp.epoch),
    await checkpointStateCache.getOrReload(cpHex),
    await checkpointStateCache.getOrReloadLatest(cpHex.rootHex, cp.epoch),
    await checkpointStateCache.getStateOrBytes(cpHex),
    await native.getPreState(block, {dontTransferCache: true}, RegenCaller.processBlock),
    await native.getBlockSlotState(forkChoice.getHead(), state.slot, {dontTransferCache: true}, RegenCaller.restApi),
    queue.getPreStateSync(block),
    Array.from(checkpointStateCache.getStates()).find((item) => item.slot === state.slot),
  ];
  for (const [index, result] of states.entries()) {
    expect(result, `checkpoint wrapper at index ${index}`).toBe(state);
    expect((result as IBeaconStateView).getAllBalances(), `memoized balances at index ${index}`).toBe(balances);
  }
  expect(checkpointStateCache.updatePreComputedCheckpoint(cpHex.rootHex, cp.epoch)).toBe(states.length);
  const replacement = anchor.processSlots(anchor.slot + 32, {dontTransferCache: true});
  cleanups.push(() => replacement.release());
  checkpointStateCache.add(cp, replacement);
  expect(checkpointStateCache.get(cpHex)).toBe(replacement);
});

it.each(["get", "getLatest", "getOrReload", "getOrReloadLatest"] as const)(
  "%s falls back for a native-only checkpoint and then reuses its JS wrapper",
  async (method) => {
    const {anchor, checkpointStateCache, queue} = fixture(0);
    await queue.init();
    const state = anchor.processSlots(anchor.slot + 32, {dontTransferCache: true});
    cleanups.push(() => state.release());
    const cp = state.computeAnchorCheckpoint().checkpoint;
    const cpHex = {epoch: cp.epoch, rootHex: toRootHex(cp.root)};
    checkpointStateCache.binding.add(cp.epoch, cp.root, getBinding(state));
    checkpointStateCache.syncCache();
    const nativeRead = vi.spyOn(
      checkpointStateCache.binding,
      method === "getOrReload" || method === "getOrReloadLatest" ? "getOrReload" : "get"
    );
    const read = () =>
      method === "get" || method === "getOrReload"
        ? checkpointStateCache[method](cpHex)
        : checkpointStateCache[method](cpHex.rootHex, cpHex.epoch);
    const restored = await read();
    if (!restored) throw Error("Missing native checkpoint");
    cleanups.push(() => restored.release());
    expect(restored).not.toBe(state);
    expect(restored.hashTreeRoot()).toEqual(state.hashTreeRoot());
    const balances = restored.getAllBalances();
    expect(await read()).toBe(restored);
    expect(checkpointStateCache.get(cpHex)?.getAllBalances()).toBe(balances);
    expect(nativeRead).toHaveBeenCalledOnce();
  }
);

it("drops JS block views on eviction and clear while preserving duplicate and head views", () => {
  const {anchor, blockStateCache} = fixture(0, 2);
  const root = toRootHex(anchor.hashTreeRoot());
  const duplicate = anchor.processSlots(anchor.slot, {dontTransferCache: true});
  cleanups.push(() => duplicate.release());
  blockStateCache.add(duplicate);
  expect(blockStateCache.get(root)).toBe(anchor);
  const next = anchor.processSlots(anchor.slot + 1, {dontTransferCache: true});
  const later = anchor.processSlots(anchor.slot + 2, {dontTransferCache: true});
  cleanups.push(
    () => next.release(),
    () => later.release()
  );
  blockStateCache.add(next);
  blockStateCache.setHeadState(next);
  blockStateCache.add(later);
  expect(blockStateCache.get(root)).toBeNull();
  expect(blockStateCache.get(toRootHex(next.hashTreeRoot()))).toBe(next);
  expect(blockStateCache.getSeedState()).toBe(next);
  blockStateCache.clear();
  expect(blockStateCache.get(toRootHex(next.hashTreeRoot()))).toBeNull();
  expect(Array.from(blockStateCache.getStates())).toHaveLength(0);
  expect(next.slot).toBe(anchor.slot + 1);
});

it.each([false, true])("drops persisted JS checkpoint views and memoizes reloads (failure=%s)", async (fail) => {
  const {anchor, checkpointStateCache, queue, controller} = fixture(0);
  await queue.init();
  const states = [32, 64, 96].map((offset) => anchor.processSlots(anchor.slot + offset, {dontTransferCache: true}));
  for (const state of states) {
    cleanups.push(() => state.release());
    checkpointStateCache.add(state.computeAnchorCheckpoint().checkpoint, state);
  }
  const state = states[0];
  const checkpoint = state.computeAnchorCheckpoint().checkpoint;
  const cp = {epoch: checkpoint.epoch, rootHex: toRootHex(checkpoint.root)};
  const latest = states[2];
  const latestRoot = toRootHex(latest.computeAnchorCheckpoint().checkpoint.root);
  if (fail) {
    const process = checkpointStateCache.binding.processState.bind(checkpointStateCache.binding);
    vi.spyOn(checkpointStateCache.binding, "processState").mockImplementationOnce((root, input) => {
      process(root, input);
      throw Error("failure after persistence");
    });
    await expect(checkpointStateCache.processState(latestRoot, latest)).rejects.toThrow("failure after persistence");
  } else {
    await expect(checkpointStateCache.processState(latestRoot, latest)).resolves.toBe(2);
  }
  controller.abort();
  expect(checkpointStateCache.get(cp)).toBeNull();
  expect(await checkpointStateCache.getStateOrBytes(cp)).toBeInstanceOf(Uint8Array);
  checkpointStateCache.add(anchor.computeAnchorCheckpoint().checkpoint, anchor);
  expect(checkpointStateCache.getLatest(cp.rootHex, cp.epoch)).toBe(anchor);
  const reload = vi.spyOn(checkpointStateCache.binding, "getOrReload");
  const restored = await checkpointStateCache.getOrReloadLatest(cp.rootHex, cp.epoch);
  expect(restored).not.toBe(state);
  expect(restored?.hashTreeRoot()).toEqual(state.hashTreeRoot());
  const balances = restored?.getAllBalances();
  expect(await checkpointStateCache.getOrReload(cp)).toBe(restored);
  expect(await checkpointStateCache.getOrReloadLatest(cp.rootHex, cp.epoch)).toBe(restored);
  expect(checkpointStateCache.get(cp)?.getAllBalances()).toBe(balances);
  expect(reload).toHaveBeenCalledOnce();
  await checkpointStateCache.clear();
  expect(checkpointStateCache.get(cp)).toBeNull();
  expect(checkpointStateCache.getLatest(cp.rootHex, Infinity)).toBeNull();
  expect(await checkpointStateCache.getOrReloadLatest(cp.rootHex, Infinity)).toBeNull();
  expect(restored?.hashTreeRoot()).toEqual(state.hashTreeRoot());
  restored?.release();
});

it("reconciles native cache mutations when regeneration fails", async () => {
  const {anchor, blockStateCache, native} = fixture(0, 1);
  const next = anchor.processSlots(anchor.slot + 1, {dontTransferCache: true});
  const later = anchor.processSlots(anchor.slot + 2, {dontTransferCache: true});
  cleanups.push(
    () => next.release(),
    () => later.release()
  );
  blockStateCache.setHeadState(next);
  blockStateCache.add(anchor);
  vi.spyOn(NativeRegeneratorBinding.prototype, "getState").mockImplementationOnce(() => {
    blockStateCache.binding.add(getBinding(later));
    throw Object.assign(Error("missing replay block"), {code: "BlockNotInCache"});
  });
  const root = toRootHex(later.hashTreeRoot());
  await expect(native.getState(root, RegenCaller.processBlock, true)).rejects.toMatchObject({
    type: {code: "REGEN_ERROR_BLOCK_NOT_IN_CACHE"},
  });
  expect(blockStateCache.get(toRootHex(anchor.hashTreeRoot()))).toBeNull();
  const restored = blockStateCache.get(root);
  expect(restored?.hashTreeRoot()).toEqual(later.hashTreeRoot());
  expect(await native.getState(root, RegenCaller.processBlock, true)).toBe(restored);
  blockStateCache.clear();
  restored?.release();
});

it("preserves invalid state root diagnostics from the binding", async () => {
  const {anchor, native} = fixture(0);
  const expected = new Uint8Array(32).fill(0xff);
  const actual = anchor.hashTreeRoot();
  vi.spyOn(NativeRegeneratorBinding.prototype, "getState").mockImplementationOnce(() => {
    throw Object.assign(Error("InvalidStateRoot"), {code: "InvalidStateRoot", slot: anchor.slot + 1, expected, actual});
  });
  await expect(native.getState(toRootHex(expected), RegenCaller.restApi)).rejects.toMatchObject({
    type: {
      code: "REGEN_ERROR_INVALID_STATE_ROOT",
      slot: anchor.slot + 1,
      expected: toRootHex(expected),
      actual: toRootHex(actual),
    },
  });
});

it("keeps synchronous reads, immediate head pinning, and queued native misses", async () => {
  const {anchor, blockStateCache, queue, native, forkChoice} = fixture();
  await queue.init();
  const root = toRootHex(anchor.hashTreeRoot());
  const sync = queue.getStateSync(root);
  expect(sync?.slot).toBe(anchor.slot);
  const call = vi.spyOn(native, "getState");
  const hit = await queue.getState(root, RegenCaller.restApi);
  expect(hit).toBe(sync);
  expect(call).not.toHaveBeenCalled();
  blockStateCache.clear();
  queue.updateHeadState(forkChoice.getHead(), anchor);
  const head = queue.getStateSync(root);
  expect(head?.slot).toBe(anchor.slot);
  await expect(queue.getState(toRootHex(new Uint8Array(32).fill(0xff)), RegenCaller.restApi)).rejects.toMatchObject({
    type: {code: "REGEN_ERROR_STATE_NOT_IN_FORKCHOICE"},
  });
  expect(call).toHaveBeenCalledOnce();
});

it("publishes checkpoints before yielding and reloads through the native cache", async () => {
  const {anchor, checkpointStateCache, queue, forkChoice, emitter} = fixture();
  await queue.init();
  const checkpoints: number[] = [];
  emitter.on(ChainEvent.checkpoint, (cp, state) => {
    const resident = checkpointStateCache.get({epoch: cp.epoch, rootHex: toRootHex(cp.root)});
    expect(resident?.hashTreeRoot()).toEqual(state.hashTreeRoot());
    checkpoints.push(cp.epoch);
  });
  const targetSlot = (anchor.epoch + 3) * 32;
  const state = await queue.getBlockSlotState(
    forkChoice.getHead(),
    targetSlot,
    {dontTransferCache: true},
    RegenCaller.processBlocksInEpoch
  );
  expect(state.slot).toBe(targetSlot);
  expect(checkpoints).toEqual([anchor.epoch + 1, anchor.epoch + 2, anchor.epoch + 3]);
  state.release();
});

it("keeps cache reads available after shutdown while stopping regen work", async () => {
  const {anchor, blockStateCache, checkpointStateCache, native, queue, controller} = fixture();
  const output = blockStateCache.get(toRootHex(anchor.hashTreeRoot()));
  const {checkpoint} = anchor.computeAnchorCheckpoint();
  const cp = {epoch: checkpoint.epoch, rootHex: toRootHex(checkpoint.root)};
  controller.abort();
  expect(blockStateCache.get(toRootHex(anchor.hashTreeRoot()))).toBe(anchor);
  expect(blockStateCache.getSeedState()).toBe(anchor);
  expect(Array.from(blockStateCache.getStates())).toEqual([anchor]);
  expect(checkpointStateCache.get(cp)).toBe(anchor);
  expect(checkpointStateCache.getLatest(cp.rootHex, Infinity)).toBe(anchor);
  expect(await checkpointStateCache.getOrReload(cp)).toBe(anchor);
  expect(await queue.getCheckpointStateOrBytes(cp)).toBe(anchor);
  const missing = toRootHex(new Uint8Array(32).fill(0xff));
  expect(blockStateCache.get(missing)).toBeNull();
  expect(checkpointStateCache.get({epoch: cp.epoch, rootHex: missing})).toBeNull();
  expect(checkpointStateCache.getLatest(missing, Infinity)).toBeNull();
  await expect(native.getState(missing, RegenCaller.restApi)).rejects.toMatchObject({
    type: {code: "NATIVE_REGEN_CLOSED"},
  });
  await expect(checkpointStateCache.processState(cp.rootHex, anchor)).rejects.toBeInstanceOf(ErrorAborted);
  expect(output?.hashTreeRoot()).toEqual(anchor.hashTreeRoot());
});

it.each([
  {elapsed: 0, maxEpochs: 0},
  {elapsed: 9000, maxEpochs: 0},
  {elapsed: 0, maxEpochs: 2},
])("processes checkpoints at the slot processing point (%j)", async ({elapsed, maxEpochs}) => {
  vi.useFakeTimers();
  const clock = new ClockStatic(0);
  vi.spyOn(clock, "msFromSlot").mockReturnValue(elapsed);
  const {anchor, checkpointStateCache} = fixture(0, 64, clock, maxEpochs);
  await checkpointStateCache.init();
  const process = vi.spyOn(checkpointStateCache.binding, "processState");
  const pending = checkpointStateCache.processState(
    toRootHex(anchor.computeAnchorCheckpoint().checkpoint.root),
    anchor
  );
  const config = createBeaconConfig(stfConfig, new Uint8Array(32));
  const delay = config.getSlotComponentDurationMs(config.getForkName(anchor.slot), 6667) - elapsed;
  if (delay > 0 && maxEpochs === 0) {
    expect(process).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(process).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
  } else {
    expect(process).toHaveBeenCalledOnce();
  }
  await expect(pending).resolves.toBe(maxEpochs === 0 ? 1 : 0);
  expect(process).toHaveBeenCalledOnce();
});

it("cancels delayed persistence on abort without disposing readable caches", async () => {
  vi.useFakeTimers();
  const clock = new ClockStatic(0);
  vi.spyOn(clock, "msFromSlot").mockReturnValue(0);
  const {anchor, checkpointStateCache, controller} = fixture(0, 64, clock, 0);
  const cp = anchor.computeAnchorCheckpoint().checkpoint;
  const process = vi.spyOn(checkpointStateCache.binding, "processState");
  const pending = checkpointStateCache.processState(toRootHex(cp.root), anchor);
  const rejected = expect(pending).rejects.toBeInstanceOf(ErrorAborted);
  controller.abort();
  await rejected;
  await vi.runAllTimersAsync();
  expect(process).not.toHaveBeenCalled();
  expect(checkpointStateCache.get({epoch: cp.epoch, rootHex: toRootHex(cp.root)})).toBe(anchor);
});

it("borrows a state after cache clearing without consuming it", async () => {
  const {anchor, blockStateCache, checkpointStateCache, queue} = fixture();
  await queue.init();
  let state: IBeaconStateView = anchor;
  for (const slot of [anchor.slot + 1, anchor.slot + 33, anchor.slot + 65]) {
    state = state.processSlots(slot, {dontTransferCache: true});
    const created = state;
    cleanups.push(() => created.release());
    checkpointStateCache.add(state.computeAnchorCheckpoint().checkpoint, state);
  }
  const expected = state.hashTreeRoot();
  const root = toRootHex(state.computeAnchorCheckpoint().checkpoint.root);
  blockStateCache.clear();
  await checkpointStateCache.clear();
  expect(blockStateCache.size).toBe(0);
  expect(checkpointStateCache.dumpSummary()).toHaveLength(0);
  await expect(checkpointStateCache.processState(root, state)).resolves.toBe(0);
  expect(state.hashTreeRoot()).toEqual(expected);
});

it.each([1, 32])("gets the prestate at offset %s through the native internal interface", async (offset) => {
  const {anchor, native, forkChoice, queue} = fixture(0);
  await queue.init();
  const regen: IStateRegeneratorInternal = native;
  expect(regen).not.toBeInstanceOf(StateRegenerator);
  const block = ssz.fulu.BeaconBlock.defaultValue();
  block.parentRoot = anchor.computeAnchorCheckpoint().checkpoint.root;
  block.slot = anchor.slot + offset;
  const state = await regen.getPreState(block, {dontTransferCache: true}, RegenCaller.processBlock);
  expect(state.slot).toBe(offset < 32 ? anchor.slot : block.slot);
  const expected = anchor.processSlots(state.slot, {dontTransferCache: true});
  expect(state.hashTreeRoot()).toEqual(expected.hashTreeRoot());
  expected.release();
  state.release();
  await expect(
    regen.getBlockSlotState(forkChoice.getHead(), anchor.slot - 1, {dontTransferCache: true}, RegenCaller.restApi)
  ).rejects.toMatchObject({type: {code: "REGEN_ERROR_SLOT_BEFORE_BLOCK_SLOT"}});
});

async function chainFixture(nativeRegen?: boolean, overrides: Partial<IChainOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lodestar-regen-flag-"));
  cleanups.push(() => rmSync(dir, {recursive: true, force: true}));
  const config = createBeaconConfig(stfConfig, new Uint8Array(32));
  pubkeyCache.ensureCapacity(16);
  const value = createStfState(0);
  const anchor = new NativeBeaconStateView(
    config,
    bindings.BeaconStateView.createFromBytes(
      ssz.fulu.BeaconState.serialize(value),
      new bindings.BeaconConfig(stfConfig, new Uint8Array(32))
    ) as IBeaconStateViewNative
  );
  cleanups.push(() => anchor.release());
  const db = getMockedBeaconDb();
  db.blockArchive.keys.mockResolvedValue([]);
  db.executionPayloadEnvelopeArchive.keys.mockResolvedValue([]);
  db.attesterSlashing.entries.mockResolvedValue([]);
  db.proposerSlashing.values.mockResolvedValue([]);
  db.voluntaryExit.values.mockResolvedValue([]);
  db.blsToExecutionChange.values.mockResolvedValue([]);
  db.proposerPreferences.values.mockResolvedValue([]);
  const chain = new BeaconChain(
    {
      ...defaultChainOptions,
      blsVerifyAllMainThread: true,
      disableLightClientServer: true,
      disablePrepareNextSlot: true,
      disableArchiveOnCheckpoint: true,
      disableImportExecutionFcU: true,
      nativeStateTransition: true,
      nativeForkChoice: true,
      nativeRegen,
      maxBlockStates: 1,
      ...overrides,
    },
    {
      privateKey: await generateKeyPair("secp256k1"),
      config,
      pubkeyCache,
      db,
      dbName: dir,
      dataDir: dir,
      logger,
      processShutdownCallback: () => {},
      clock: new ClockStatic(anchor.slot + 2),
      metrics: null,
      validatorMonitor: null,
      anchorState: anchor,
      isAnchorStateFinalized: true,
      earliestAvailableSlot: anchor.slot,
      executionEngine: new ExecutionEngineDisabled(),
    }
  );
  const states: IBeaconStateView[] = [];
  cleanups.push(async () => {
    await chain.close();
    for (const state of states) state.release();
  });
  await chain.init();
  return {chain, anchor, db, states};
}

it.each([undefined, false, true])(
  "selects regen through BeaconChain with nativeRegen=%s and replays an imported block",
  async (nativeRegen) => {
    const nativeCall = vi.spyOn(NativeStateRegenerator.prototype, "getState");
    const nativeApiCall = vi.spyOn(NativeRegenerator.prototype, "getState");
    const tsCall = vi.spyOn(StateRegenerator.prototype, "getState");
    const {chain, anchor, db, states} = await chainFixture(nativeRegen);
    const addBlock = chain.nativeRegen ? vi.spyOn(chain.nativeRegen, "addBlock") : undefined;
    const seenBlockInputGet = vi.spyOn(chain.seenBlockInputCache, "get");
    expect(chain.nativeRegen instanceof NativeStateRegenerator).toBe(nativeRegen === true);
    const blocks = [];
    let preState: IBeaconStateView = anchor;
    for (let i = 1; i <= 2; i++) {
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = anchor.slot + i;
      const advanced = preState.processSlots(block.message.slot, {dontTransferCache: true});
      block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
      block.message.proposerIndex = advanced.getBeaconProposer(block.message.slot);
      block.message.body.executionPayload.timestamp = block.message.slot * stfConfig.SECONDS_PER_SLOT;
      block.message.body.executionPayload.prevRandao = advanced.getRandaoMix(advanced.epoch);
      advanced.release();
      const postState = preState.stateTransition(
        {block},
        {
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
          dontTransferCache: true,
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
        },
        {}
      );
      states.push(postState);
      block.message.stateRoot = postState.hashTreeRoot();
      const root = toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(block.message));
      const cachedBytes = i === 1 ? ssz.fulu.SignedBeaconBlock.serialize(block) : undefined;
      if (cachedBytes) chain.serializedCache.set(block, cachedBytes);
      await importBlock.call(
        chain,
        {
          blockInput: BlockInputColumns.createFromBlock({
            block,
            blockRootHex: root,
            forkName: ForkName.fulu,
            source: BlockInputSource.byRange,
            seenTimestampSec: Date.now() / 1000,
            daOutOfRange: false,
            sampledColumns: chain.custodyConfig.sampledColumns,
            custodyColumns: chain.custodyConfig.custodyColumns,
          }),
          postState,
          parentBlockSlot: preState.slot,
          proposerBalanceDelta: 0,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
          indexedAttestations: [],
          seenTimestampSec: Date.now() / 1000,
          executionStatus: ExecutionStatus.Valid,
        },
        {}
      );
      if (addBlock && cachedBytes) expect(addBlock.mock.lastCall?.[1], "reuse cached block bytes").toBe(cachedBytes);
      blocks.push(block);
      preState = postState;
    }
    const target = states[0];
    const root = toRootHex(target.hashTreeRoot());
    expect(chain.regen.getStateSync(root), "first block must be evicted before replay").toBeNull();
    nativeCall.mockClear();
    nativeApiCall.mockClear();
    tsCall.mockClear();
    seenBlockInputGet.mockClear();
    db.block.get.mockClear();
    db.block.get.mockResolvedValue(blocks[0]);
    const replayed = await chain.regen.getState(root, RegenCaller.restApi);
    expect(replayed.hashTreeRoot()).toEqual(target.hashTreeRoot());
    expect(nativeApiCall).toHaveBeenCalledTimes(nativeRegen ? 1 : 0);
    if (nativeRegen) {
      expect(nativeApiCall.mock.results[0].value).toBeInstanceOf(NativeBeaconStateView);
      expect(nativeApiCall.mock.results[0].value).toBe(replayed);
    }
    replayed.release();
    expect(nativeCall).toHaveBeenCalledTimes(nativeRegen ? 1 : 0);
    expect(tsCall).toHaveBeenCalledTimes(nativeRegen ? 0 : 1);
    expect(seenBlockInputGet).toHaveBeenCalledTimes(nativeRegen ? 0 : 1);
    expect(db.block.get).toHaveBeenCalledTimes(nativeRegen ? 0 : 1);
    if (chain.nativeRegen) {
      const head = chain.forkChoice.getBlockHexDefaultStatus(
        toRootHex(ssz.fulu.BeaconBlock.hashTreeRoot(blocks[1].message))
      );
      if (!head) throw Error("missing imported head");
      chain.regen.updateHeadState(head, states[1]);
      const anchorRoot = toRootHex(anchor.hashTreeRoot());
      chain.regen.processState(toRootHex(anchor.computeAnchorCheckpoint().checkpoint.root), anchor);
      expect(chain.regen.getStateSync(anchorRoot)).toBe(anchor);
      const restored = await chain.nativeRegen.getState(root, RegenCaller.processBlock, true);
      states.push(restored);
      expect(restored.hashTreeRoot()).toEqual(target.hashTreeRoot());
      expect(chain.regen.getStateSync(root)).toBe(restored);
      expect(chain.regen.getStateSync(anchorRoot)).toBeNull();
      nativeCall.mockClear();
      expect(await chain.regen.getState(root, RegenCaller.restApi)).toBe(restored);
      expect(nativeCall).not.toHaveBeenCalled();
    }
  }
);

it.each([{nativeForkChoice: false}, {nHistoricalStatesFileDataStore: false}])(
  "rejects incompatible native regen options %s at startup",
  async (opts) => {
    await expect(chainFixture(true, opts)).rejects.toMatchObject({
      type: {code: "NATIVE_REGEN_REQUIRES_NATIVE_STATE_FORK_CHOICE_AND_FILE_STORE"},
    });
  }
);

it("closes native caches when fork-choice initialization fails", async () => {
  const closeBlock = vi.spyOn(NativeBlockStateCache.prototype, "close");
  const closeCheckpoint = vi.spyOn(NativeCheckpointStateCache.prototype, "close");
  await expect(chainFixture(true, {proposerBoost: false})).rejects.toThrow(
    "The native fork choice always applies proposer boost"
  );
  expect(closeBlock).toHaveBeenCalledOnce();
  expect(closeCheckpoint).toHaveBeenCalledOnce();
});

it("closes native regen once and leaves cache reads available after chain.close", async () => {
  const {chain, anchor} = await chainFixture(true);
  const close = vi.spyOn(NativeStateRegenerator.prototype, "close");
  await chain.close();
  expect(close).toHaveBeenCalledOnce();
  expect(chain.regen.getStateSync(toRootHex(anchor.hashTreeRoot()))).toBe(anchor);
  const cp = anchor.computeAnchorCheckpoint().checkpoint;
  expect(await chain.regen.getCheckpointStateOrBytes({epoch: cp.epoch, rootHex: toRootHex(cp.root)})).toBe(anchor);
});

const stfConfig = {...mainnetChainConfig, GLOAS_FORK_EPOCH: Infinity};
function createStfState(slotOffset = 31) {
  const state = ssz.fulu.BeaconState.defaultValue();
  state.slot = stfConfig.FULU_FORK_EPOCH * 32 + slotOffset;
  state.latestBlockHeader.slot = state.slot;
  state.fork = {
    currentVersion: stfConfig.FULU_FORK_VERSION,
    previousVersion: stfConfig.ELECTRA_FORK_VERSION,
    epoch: stfConfig.FULU_FORK_EPOCH,
  };
  state.validators = Array.from({length: 16}, (_, index) => ({
    ...ssz.phase0.Validator.defaultValue(),
    activationEpoch: 0,
    effectiveBalance: 32_000_000_000,
    exitEpoch: Infinity,
    withdrawableEpoch: Infinity,
    pubkey: SecretKey.fromKeygen(new Uint8Array(32).fill(index + 1))
      .toPublicKey()
      .toBytes(),
  }));
  state.balances = state.validators.map(() => 32_000_000_000);
  state.previousEpochParticipation = state.validators.map(() => 0);
  state.currentEpochParticipation = state.validators.map(() => 0);
  state.inactivityScores = state.validators.map(() => 0);
  state.currentSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  state.nextSyncCommittee.pubkeys.fill(state.validators[0].pubkey);
  return state;
}
