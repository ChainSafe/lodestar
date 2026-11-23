import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ssz} from "@lodestar/types";
import {ExecutionStatus, ForkChoice} from "../../src/fork-choice.js";
import bindings from "../../src/index.js";
import {BlockStateCache, CheckpointStateCache, SeenBlock, StateRegenerator} from "../../src/regen.js";
import {createStfState, stfConfig} from "../stfFixture.js";

bindings.pubkeys.ensureCapacity(16);
const dir = mkdtempSync(join(tmpdir(), "lodestar-regen-teardown-"));
const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
const blockCache = new BlockStateCache(state, 2);
const checkpointCache = new CheckpointStateCache(blockCache, dir, 2);
checkpointCache.initStore();
blockCache.add(state);
const cp = state.computeAnchorCheckpoint().checkpoint;
checkpointCache.add(cp.epoch, cp.root, state);
const expected = state.hashTreeRoot();
const retainedRegen =
  process.argv[2] === "regenerator"
    ? (() => {
        const seen = new SeenBlock(4, 1024 * 1024, 1024 * 1024);
        const forkChoice = new ForkChoice(
          config,
          0,
          {
            executionStatus: ExecutionStatus.PreMerge,
            finalizedCheckpoint: cp,
            justifiedCheckpoint: cp,
            parentRoot: new Uint8Array(32),
            proposerIndex: 0,
            root: cp.root,
            slot: state.slot,
            stateRoot: expected,
            unrealizedFinalizedCheckpoint: cp,
            unrealizedJustifiedCheckpoint: cp,
          },
          {
            justifiedBalances: () => new Uint16Array(16).fill(32),
            slotCommitteeMembers: () => new Uint32Array(0),
          }
        );
        const regen = new StateRegenerator(blockCache, checkpointCache, seen, forkChoice);
        seen.release();
        return {forkChoice: new WeakRef(forkChoice), regen};
      })()
    : null;
const alias = blockCache.get(expected);
assert(alias);
state.release();
if (process.argv[2] !== "block cache") blockCache.release();
if (process.argv[2] !== "checkpoint cache") checkpointCache.release();
assert(global.gc);
global.gc();
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(alias.hashTreeRoot(), expected);
const child = alias.processSlots(alias.slot + 1, {dontTransferCache: true});
alias.release();
if (retainedRegen) {
  child.release();
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    global.gc();
  }
  assert.equal(retainedRegen.forkChoice.deref(), undefined, "ForkChoice wrapper must finalize before regen");
  const result = retainedRegen.regen.getState(expected, false);
  assert.deepEqual(result.hashTreeRoot(), expected);
  result.release();
  assert.throws(() => retainedRegen.regen.getState(new Uint8Array(32).fill(0xff), false), {
    code: "StateNotInForkChoice",
  });
  Object.assign(globalThis, {retainedNativeRegenerator: retainedRegen.regen});
} else if (process.argv[2] === "exported state") {
  Object.assign(globalThis, {retainedNativeState: child});
} else {
  child.release();
  Object.assign(globalThis, {retainedNativeCache: process.argv[2] === "block cache" ? blockCache : checkpointCache});
}
process.stdout.write(dir);
