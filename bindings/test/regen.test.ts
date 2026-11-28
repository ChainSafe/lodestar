import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {ssz} from "@lodestar/types";
import {afterEach, describe, expect, it} from "vitest";
import {ExecutionStatus, ForkChoice} from "../src/fork-choice.js";
import bindings from "../src/index.js";
import {BlockStateCache, CheckpointStateCache, SeenBlock, StateRegenerator} from "../src/regen.js";
import {createStfState, stfConfig} from "./stfFixture.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});
function own<T extends {release(): void}>(value: T | undefined): T {
  if (value === undefined) throw Error("Expected an owned native object");
  cleanups.push(() => value.release());
  return value;
}
function root(value: number): Uint8Array {
  return new Uint8Array(32).fill(value);
}
function fixture(maxCheckpointEpochs = 2) {
  const dir = mkdtempSync(join(tmpdir(), "lodestar-regen-binding-"));
  cleanups.push(() => rmSync(dir, {force: true, recursive: true}));
  bindings.pubkeys.ensureCapacity(16);
  const config = new bindings.BeaconConfig(stfConfig, root(0));
  const state = own(bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config));
  const blockCache = own(new BlockStateCache(state, 1));
  const checkpointCache = own(new CheckpointStateCache(blockCache, dir, maxCheckpointEpochs));
  checkpointCache.initStore();
  blockCache.add(state);
  const cp = state.computeAnchorCheckpoint().checkpoint;
  checkpointCache.add(cp.epoch, cp.root, state);
  const seen = own(new SeenBlock(4, 1024 * 1024, 1024 * 1024));
  const forkChoice = new ForkChoice(
    config,
    0,
    {
      executionStatus: ExecutionStatus.PreMerge,
      finalizedCheckpoint: cp,
      justifiedCheckpoint: cp,
      parentRoot: root(0),
      proposerIndex: 0,
      root: cp.root,
      slot: state.slot,
      stateRoot: state.hashTreeRoot(),
      unrealizedFinalizedCheckpoint: cp,
      unrealizedJustifiedCheckpoint: cp,
    },
    {
      justifiedBalances: () => new Uint16Array(16).fill(32),
      slotCommitteeMembers: () => new Uint32Array(0),
    }
  );
  const regen = own(new StateRegenerator(blockCache, checkpointCache, seen, forkChoice));
  return {blockCache, checkpointCache, cp, dir, forkChoice, regen, seen, state};
}

describe("SeenBlock binding", () => {
  it("copies inputs and outputs and preserves duplicates", () => {
    const cache = own(new SeenBlock(2, 8, 4));
    const bytes = new Uint8Array([1, 2]);
    expect(cache.add(root(1), bytes)).toBe(true);
    bytes.fill(9);
    const result = cache.get(root(1));
    expect(result).toEqual(new Uint8Array([1, 2]));
    result?.fill(7);
    expect(cache.add(root(1), new Uint8Array(8))).toBe(false);
    expect(cache.get(root(1))).toEqual(new Uint8Array([1, 2]));
    expect(cache.byteSize).toBe(2);
  });
  it("evicts FIFO and rejects invalid lengths, limits and released handles", () => {
    const cache = own(new SeenBlock(1, 4, 4));
    expect(() => cache.add(new Uint8Array(31), new Uint8Array([1]))).toThrow();
    expect(() => cache.add(root(1), new Uint8Array(5))).toThrowError(expect.objectContaining({code: "BlockTooLarge"}));
    expect(() => new SeenBlock(0, 4, 4)).toThrow();
    expect(() => new SeenBlock(-1, 4, 4)).toThrow();
    cache.add(root(1), new Uint8Array([1]));
    cache.add(root(2), new Uint8Array([2]));
    expect(cache.get(root(1))).toBeUndefined();
    expect(cache.size).toBe(1);
    cache.release();
    expect(() => cache.size).toThrowError(expect.objectContaining({code: "SeenBlockReleased"}));
  });
});

describe("shared native states", () => {
  it("returns owned checkpoint views from every read API and undefined for misses", () => {
    const {state, blockCache, checkpointCache, cp, regen} = fixture();
    const expected = state.hashTreeRoot();
    const views = [
      own(checkpointCache.get(cp.epoch, cp.root)),
      own(checkpointCache.getLatest(cp.root, cp.epoch)),
      own(checkpointCache.getLatest(cp.root)),
      own(checkpointCache.getOrReload(cp.epoch, cp.root)),
      own(checkpointCache.getOrReloadLatest(cp.root, cp.epoch)),
      own(checkpointCache.getOrReloadLatest(cp.root)),
    ];
    expect(new Set(views).size).toBe(views.length);
    expect(checkpointCache.get(cp.epoch, root(255))).toBeUndefined();
    expect(checkpointCache.getLatest(root(255))).toBeUndefined();
    expect(checkpointCache.getOrReload(cp.epoch, root(255))).toBeUndefined();
    expect(checkpointCache.getOrReloadLatest(root(255))).toBeUndefined();
    state.release();
    checkpointCache.clear();
    blockCache.clear();
    expect(() => blockCache.getSeedState()).toThrowError(expect.objectContaining({code: "NoSeedState"}));
    regen.release();
    checkpointCache.release();
    blockCache.release();
    for (const [index, view] of views.entries()) {
      expect(view.hashTreeRoot(), `returned view ${index} survives cache and sibling release`).toEqual(expected);
      view.release();
    }
  });

  it("retains the original anchor slot and survives either cache and wrapper release order", () => {
    const {state, blockCache, checkpointCache, cp, regen} = fixture();
    const expected = state.hashTreeRoot();
    const slot = state.slot;
    const alias = own(checkpointCache.get(cp.epoch, cp.root));
    expect(alias.slot).toBe(slot);
    state.release();
    state.release();
    blockCache.clear();
    checkpointCache.clear();
    regen.release();
    checkpointCache.release();
    blockCache.release();
    expect(alias.hashTreeRoot()).toEqual(expected);
    const child = own(alias.processSlots(slot + 1, {dontTransferCache: true}));
    alias.release();
    expect(child.slot).toBe(slot + 1);
  });
  it("keeps an exported state alive through FIFO eviction", () => {
    const {state, blockCache, checkpointCache, regen} = fixture();
    const expected = state.hashTreeRoot();
    const alias = own(blockCache.get(expected));
    const next = own(state.processSlots(state.slot + 1, {dontTransferCache: true}));
    const later = own(next.processSlots(next.slot + 1, {dontTransferCache: true}));
    blockCache.setHeadState(next);
    blockCache.add(later);
    expect(blockCache.get(expected)).toBeUndefined();
    checkpointCache.clear();
    state.release();
    regen.release();
    checkpointCache.release();
    blockCache.release();
    expect(alias.hashTreeRoot()).toEqual(expected);
  });
  it("keeps resident references after an invalid read or explicit returned-view release", () => {
    const {state, blockCache} = fixture();
    const expected = state.hashTreeRoot();
    expect(() => blockCache.get(new Uint8Array(31))).toThrow();
    const alias = own(blockCache.get(expected));
    expect(alias).not.toBe(state);
    alias.release();
    const next = own(blockCache.get(expected));
    expect(next.hashTreeRoot()).toEqual(expected);
    expect(blockCache.stats().hits).toBe(2);
    expect(blockCache.dumpSummary()[0].lastRead).toBeGreaterThan(Date.now() - 1000);
  });
  it.each(["block", "checkpoint"])("finishes borrowing the %s cache before JS property setters run", (kind) => {
    const {blockCache, checkpointCache, regen} = fixture();
    regen.release();
    const cache = kind === "block" ? blockCache : checkpointCache;
    (kind === "block" ? checkpointCache : blockCache).release();
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "lookups");
    let released = false;
    let stats: {lookups: number};
    try {
      Object.defineProperty(Object.prototype, "lookups", {
        configurable: true,
        set(this: object, value: number) {
          cache.release();
          released = true;
          Object.defineProperty(this, "lookups", {configurable: true, enumerable: true, value, writable: true});
        },
      });
      stats = cache.stats();
    } finally {
      if (descriptor) Object.defineProperty(Object.prototype, "lookups", descriptor);
      else Reflect.deleteProperty(Object.prototype, "lookups");
    }
    expect(released).toBe(true);
    expect(stats.lookups).toBe(0);
    expect(() => cache.stats()).toThrowError(
      expect.objectContaining({code: kind === "block" ? "BlockStateCacheReleased" : "CheckpointStateCacheReleased"})
    );
  });
  it("retains caches and SeenBlock after their JS wrappers are released", () => {
    const {state, blockCache, checkpointCache, seen, regen} = fixture();
    const expected = state.hashTreeRoot();
    state.release();
    checkpointCache.release();
    blockCache.release();
    seen.release();
    const output = own(regen.getState(expected, false));
    regen.release();
    expect(output.hashTreeRoot()).toEqual(expected);
  });
  it("keeps the block cache usable after releasing the checkpoint cache", () => {
    const {state, blockCache, checkpointCache, regen} = fixture();
    const expected = state.hashTreeRoot();
    regen.release();
    checkpointCache.release();
    state.release();
    const output = own(blockCache.get(expected));
    expect(output.hashTreeRoot()).toEqual(expected);
    expect(() => checkpointCache.stats()).toThrowError(expect.objectContaining({code: "CheckpointStateCacheReleased"}));
  });
  it("rejects invalid roots, slots, state backings and input handles", () => {
    const {state, blockCache, checkpointCache, regen, seen, forkChoice} = fixture();
    const empty = own(new bindings.BeaconStateView());
    expect(() => regen.getState(new Uint8Array(31), false)).toThrow();
    expect(() => regen.getBlockSlotState(root(1), -1, false, false)).toThrow();
    expect(() => blockCache.add(empty)).toThrowError(expect.objectContaining({code: "InvalidState"}));
    const other = own(
      bindings.BeaconStateView.createFromBytes(
        ssz.fulu.BeaconState.serialize(createStfState()),
        new bindings.BeaconConfig({...stfConfig, SECONDS_PER_ETH1_BLOCK: 15}, root(0))
      )
    );
    expect(() => blockCache.add(other)).toThrowError(expect.objectContaining({code: "StateBackingMismatch"}));
    const dir = mkdtempSync(join(tmpdir(), "lodestar-regen-mismatch-"));
    cleanups.push(() => rmSync(dir, {force: true, recursive: true}));
    const otherBlockCache = own(new BlockStateCache(other, 1));
    const otherCheckpointCache = own(new CheckpointStateCache(otherBlockCache, dir, 2));
    expect(() => new StateRegenerator(otherBlockCache, otherCheckpointCache, seen, forkChoice)).toThrowError(
      expect.objectContaining({code: "StateConfigMismatch"})
    );
    expect(() => new StateRegenerator(otherBlockCache, checkpointCache, seen, forkChoice)).toThrowError(
      expect.objectContaining({code: "StateCacheMismatch"})
    );
    empty.release();
    expect(() => blockCache.add(empty)).toThrowError(expect.objectContaining({code: "InvalidState"}));
    expect(own(blockCache.getSeedState()).hashTreeRoot()).toEqual(state.hashTreeRoot());
  });
  it("exports direct native prestate and block-slot results", () => {
    const {state, regen, cp} = fixture();
    const slot = state.slot + 1;
    const expected = own(state.processSlots(slot, {dontTransferCache: true}));
    const blockSlot = own(regen.getBlockSlotState(cp.root, slot, true, false));
    const preState = own(regen.getPreState(cp.root, slot, true));
    expect(blockSlot.hashTreeRoot()).toEqual(expected.hashTreeRoot());
    expect(preState.hashTreeRoot()).toEqual(expected.hashTreeRoot());
  });
  it("reloads from a retained block-cache seed after the block wrapper is released", () => {
    const {state, blockCache, checkpointCache, cp, dir, regen} = fixture(0);
    checkpointCache.clear();
    const first = own(state.processSlots(state.slot + 1, {dontTransferCache: true}));
    const firstRoot = first.hashTreeRoot();
    checkpointCache.add(first.epoch, cp.root, first);
    let current = first;
    for (let i = 0; i < 3; i++) {
      current = own(current.processSlots(current.slot + 32, {dontTransferCache: true}));
      checkpointCache.add(current.epoch, cp.root, current);
    }
    expect(checkpointCache.processState(cp.root, current)).toBeGreaterThan(0);
    expect(checkpointCache.get(first.epoch, cp.root)).toBeUndefined();
    expect(checkpointCache.getBytes(first.epoch, cp.root)).toEqual(first.serialize());
    const epoch = first.epoch;
    regen.release();
    expect(checkpointCache.stats().inMemory).toBe(0);
    blockCache.release();
    state.release();
    first.release();
    current.release();
    expect(() => blockCache.stats()).toThrowError(expect.objectContaining({code: "BlockStateCacheReleased"}));
    expect(() => new CheckpointStateCache(blockCache, dir, 2)).toThrowError(
      expect.objectContaining({code: "BlockStateCacheReleased"})
    );
    const result = own(checkpointCache.getOrReload(epoch, cp.root));
    checkpointCache.release();
    expect(result.hashTreeRoot()).toEqual(firstRoot);
    expect(own(result.processSlots(result.slot + 1)).slot).toBe(result.slot + 1);
  });
  it.each(["block cache", "checkpoint cache", "exported state", "regenerator"])(
    "finalizes %s after environment cleanup",
    (owner) => {
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--import",
          "tsx",
          fileURLToPath(new URL("./fixtures/regenTeardown.ts", import.meta.url)),
          owner,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
        }
      );
      if (result.stdout) cleanups.push(() => rmSync(result.stdout, {force: true, recursive: true}));
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    }
  );
  it.each([false, true])("replays shared SeenBlock bytes and validates the state root (invalid=%s)", (invalid) => {
    const {state, blockCache, checkpointCache, seen, regen, forkChoice, cp} = fixture();
    const slot = state.slot + 1;
    const advanced = own(state.processSlots(slot, {dontTransferCache: true}));
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = advanced.getBeaconProposer(slot);
    block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
    block.message.body.executionPayload.timestamp = slot * stfConfig.SECONDS_PER_SLOT;
    block.message.body.executionPayload.prevRandao = advanced.getRandaoMix(advanced.epoch);
    const expected = own(
      state.stateTransition(ssz.fulu.SignedBeaconBlock.serialize(block), false, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      })
    );
    block.message.stateRoot = invalid ? root(0xfe) : expected.hashTreeRoot();
    const blockRoot = ssz.fulu.BeaconBlock.hashTreeRoot(block.message);
    expect(block.message.parentRoot).toEqual(cp.root);
    forkChoice.onTick(forkChoice.timeAtSlotMs(slot));
    forkChoice.onBlock({
      executionStatus: ExecutionStatus.PreMerge,
      finalizedCheckpoint: cp,
      justifiedCheckpoint: cp,
      parentRoot: cp.root,
      proposerIndex: block.message.proposerIndex,
      root: blockRoot,
      slot,
      stateRoot: block.message.stateRoot,
      unrealizedFinalizedCheckpoint: cp,
      unrealizedJustifiedCheckpoint: cp,
    });
    expect(() => regen.getState(block.message.stateRoot, false)).toThrowError(
      expect.objectContaining({code: "BlockNotInCache"})
    );
    const bytes = ssz.fulu.SignedBeaconBlock.serialize(block);
    seen.add(blockRoot, bytes);
    bytes.fill(0);
    if (invalid) {
      for (const read of [
        () => regen.getState(block.message.stateRoot, true),
        () => regen.getPreState(blockRoot, slot + 1, true),
        () => regen.getBlockSlotState(blockRoot, slot, true, true),
      ]) {
        expect(read).toThrowError(
          expect.objectContaining({
            actual: expected.hashTreeRoot(),
            code: "InvalidStateRoot",
            expected: block.message.stateRoot,
            slot,
          })
        );
      }
      expect(blockCache.get(block.message.stateRoot)).toBeUndefined();
      return;
    }
    const output = own(regen.getState(expected.hashTreeRoot(), false));
    expect(output.hashTreeRoot()).toEqual(expected.hashTreeRoot());
    expect(blockCache.size).toBe(1);
    seen.clear();
    expect(() => regen.getState(expected.hashTreeRoot(), false)).toThrowError(
      expect.objectContaining({code: "BlockNotInCache"})
    );
    regen.release();
    checkpointCache.release();
    blockCache.release();
    expect(output.slot).toBe(slot);
  });
});
