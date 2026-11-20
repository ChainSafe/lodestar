import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {ssz} from "../../packages/types/lib/index.js";
import {chainConfigFromJson, createBeaconConfig, defaultChainConfig} from "../../packages/config/lib/index.js";
import {pubkeyCache} from "../../bindings/src/pubkeys.js";
import {createBeaconStateView} from "../../packages/state-transition/lib/stateView/stateViewFactory.js";
import {DataAvailabilityStatus, ExecutionPayloadStatus} from "../../packages/state-transition/lib/index.js";

const fixtures = process.argv[2];
assert.ok(fixtures, "Usage: node scripts/builder/qualifyNativeUpgrade.mjs <fixture-directory>");
const meta = JSON.parse(readFileSync(resolve(fixtures, "plataberget-state.json")));
const stateBytes = readFileSync(resolve(fixtures, "plataberget-state.ssz"));
const hex = (value) => "0x" + Buffer.from(value).toString("hex");
const genesisRoot = Buffer.from(meta.genesis.data.genesis_validators_root.slice(2), "hex");
const config = createBeaconConfig({...defaultChainConfig, ...chainConfigFromJson(meta.config.data)}, genesisRoot);
assert.equal(meta.version, "gloas");
const raw = ssz.gloas.BeaconState.deserializeToViewDU(stateBytes);
const validatorCount = raw.validators.length;
assert.equal(hex(raw.hashTreeRoot()), meta.header.header.message.state_root);
pubkeyCache.ensureCapacity(validatorCount);
const states = [];
const started = performance.now();
try {
  const tree = createBeaconStateView({nativeStateTransition: false, config, stateBytes});
  states.push(tree);
  const native = createBeaconStateView({nativeStateTransition: true, config, stateBytes});
  states.push(native);
  assert.equal(hex(native.hashTreeRoot()), hex(tree.hashTreeRoot()));
  assert.equal(native.slot, tree.slot);
  assert.deepEqual(native.latestExecutionPayloadBid, tree.latestExecutionPayloadBid);
  assert.deepEqual(native.builderPendingPayments, tree.builderPendingPayments);
  assert.deepEqual(native.builderPendingWithdrawals, tree.builderPendingWithdrawals);
  const roots = [];
  for (const delta of [1, 32]) {
    const target = tree.slot + delta;
    const js = tree.processSlots(target);
    states.push(js);
    const zig = native.processSlots(target);
    states.push(zig);
    assert.equal(hex(zig.hashTreeRoot()), hex(js.hashTreeRoot()));
    assert.equal(zig.getBeaconProposer(target), js.getBeaconProposer(target));
    roots.push({slot: target, root: hex(zig.hashTreeRoot())});
  }
  const replay = JSON.parse(readFileSync(resolve(fixtures, "plataberget-blocks.json")));
  const firstBlock = ssz.gloas.SignedBeaconBlock.deserialize(Buffer.from(replay.blocks[0].ssz, "base64"));
  const jsFull = tree.withParentPayloadApplied(firstBlock.message.body.parentExecutionRequests);
  states.push(jsFull);
  const zigFull = native.withParentPayloadApplied(firstBlock.message.body.parentExecutionRequests);
  states.push(zigFull);
  assert.equal(hex(zigFull.hashTreeRoot()), hex(jsFull.hashTreeRoot()));
  assert.equal(hex(native.hashTreeRoot()), meta.header.header.message.state_root);
  assert.equal(hex(tree.hashTreeRoot()), meta.header.header.message.state_root);
  assert.deepEqual(zigFull.builderPendingPayments, jsFull.builderPendingPayments);
  assert.deepEqual(zigFull.builderPendingWithdrawals, jsFull.builderPendingWithdrawals);
  const parentBranchRoot = hex(zigFull.hashTreeRoot());
  const blockRoots = [];
  let jsHead = tree;
  let zigHead = native;
  let parentRoot = meta.header.root;
  for (const sample of replay.blocks) {
    const bytes = Buffer.from(sample.ssz, "base64");
    const block = ssz.gloas.SignedBeaconBlock.deserialize(bytes);
    assert.equal(hex(block.message.parentRoot), parentRoot);
    const options = {
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.NotRequired,
      verifyStateRoot: true,
      verifyProposer: true,
      verifySignatures: true,
      dontTransferCache: true,
    };
    const js = jsHead.stateTransition({block, ssz: bytes}, options, {});
    states.push(js);
    const zig = zigHead.stateTransition({block, ssz: bytes}, options, {});
    states.push(zig);
    assert.equal(hex(zig.hashTreeRoot()), hex(block.message.stateRoot));
    assert.equal(hex(zig.hashTreeRoot()), hex(js.hashTreeRoot()));
    if (jsHead !== tree) {
      jsHead.release();
      states.splice(states.indexOf(jsHead), 1);
    }
    if (zigHead !== native) {
      zigHead.release();
      states.splice(states.indexOf(zigHead), 1);
    }
    jsHead = js;
    zigHead = zig;
    parentRoot = hex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    blockRoots.push({slot: block.message.slot, stateRoot: hex(zig.hashTreeRoot())});
  }
  console.log(
    JSON.stringify({
      network: "plataberget",
      slot: tree.slot,
      validatorCount,
      bytes: stateBytes.length,
      stateRoot: hex(native.hashTreeRoot()),
      transitions: roots,
      replayedBlocks: blockRoots,
      missedSlots: replay.missed,
      signaturesVerified: true,
      fullParentPreparationRoot: parentBranchRoot,
      emptyParentUnchanged: true,
      executionValidation: "trusted existing canonical payloads, no Engine calls",
      elapsedMs: performance.now() - started,
      passed: true,
    })
  );
} finally {
  for (const state of states.reverse()) state.release();
}
