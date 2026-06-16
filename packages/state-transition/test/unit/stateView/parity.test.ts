import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {BeaconStateView as BeaconStateViewZig, stateTransition} from "@chainsafe/lodestar-z/state-transition";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {phase0, ssz} from "@lodestar/types";
import {
  BeaconStateView,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  type IBeaconStateView,
  type StateTransitionOpts,
  createCachedBeaconState,
  createPubkeyCache,
  setUseNativeStateTransition,
} from "../../../src/index.js";
import {generateState} from "../../utils/state.js";

describe("NativeBeaconStateView parity", () => {
  it("phase0 empty block — post-state hashTreeRoot matches", () => {
    const config = createBeaconConfig(defaultConfig, ssz.Root.defaultValue());

    const pre = generateState({slot: 0}, config);
    // generateValidator returns the same hardcoded pubkey for every validator, which makes the
    // native binding's global pubkey_to_index map collapse to a single entry while index_to_pubkey
    // keeps N. That leaves syncPubkeys's consistency check tripping on the second createFromBytes
    // call. Production states always have unique pubkeys, so just patch the test fixture.
    // generateValidator returns the same hardcoded pubkey for every validator, which makes the
    // native binding's global pubkey_to_index map collapse to a single entry while index_to_pubkey
    // keeps N — tripping syncPubkeys's consistency check on the second createFromBytes call.
    // Production states always have unique pubkeys; patch the fixture with unique valid BLS pubkeys.
    for (let i = 0; i < pre.validators.length; i++) {
      const v = pre.validators.get(i);
      const seed = new Uint8Array(32);
      new DataView(seed.buffer).setUint32(0, i + 1);
      v.pubkey = SecretKey.fromKeygen(seed).toPublicKey().toBytes();
      pre.validators.set(i, v);
    }
    pre.commit();
    const cached = createCachedBeaconState(pre, {config, pubkeyCache: createPubkeyCache()}, {skipSyncPubkeys: false});
    const stateBytes = cached.serialize();

    const lbh = cached.latestBlockHeader.toValue();
    lbh.stateRoot = cached.hashTreeRoot();
    const parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(lbh);

    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.proposerIndex = cached.epochCtx.getBeaconProposer(1);
    block.message.parentRoot = parentRoot;

    const opts: StateTransitionOpts = {
      verifyStateRoot: false,
      verifyProposer: false,
      verifySignatures: false,
      executionPayloadStatus: ExecutionPayloadStatus.valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    };

    const zigPre = BeaconStateViewZig.createFromBytes(stateBytes);
    expect(zigPre.hashTreeRoot()).toEqual(cached.hashTreeRoot());
    expect(zigPre.serialize()).toEqual(stateBytes);
    const blockBytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const zigPost = stateTransition(zigPre, blockBytes, opts);

    const tsPost: IBeaconStateView = new BeaconStateView(cached).stateTransition(block, opts, {});

    expect(zigPost.hashTreeRoot()).toEqual(tsPost.hashTreeRoot());
    expect(zigPost.serialize()).toEqual(tsPost.serialize());
    expect(zigPost.slot).toEqual(tsPost.slot);
    expect(zigPost.validatorCount).toEqual(tsPost.validatorCount);

    // Flip the global flag on: the TS BeaconStateView class's stateTransition method should
    // now dispatch through the native binding via the stateTransition() function, and produce
    // a post-state byte-identical to the pure-TS path.
    try {
      setUseNativeStateTransition(true);
      const nativeRoutedPost: IBeaconStateView = new BeaconStateView(cached).stateTransition(block, opts, {});
      expect(nativeRoutedPost.hashTreeRoot()).toEqual(tsPost.hashTreeRoot());
      expect(nativeRoutedPost.serialize()).toEqual(tsPost.serialize());
    } finally {
      setUseNativeStateTransition(false);
    }

    // Native getVoluntaryExitValidity / isValidVoluntaryExit accept a deserialized
    // phase0.SignedVoluntaryExit object (Option A). Smoke-test the JS↔Zig object walk.
    const signedExit: phase0.SignedVoluntaryExit = {
      message: {epoch: 0, validatorIndex: 0},
      signature: new Uint8Array(96),
    };
    // The fixture's validators don't satisfy active/long-enough so this returns "inactive",
    // not "valid" — what matters is the call dispatched through Zig without an INVALID_ARG.
    const tsValidity = new BeaconStateView(cached).getVoluntaryExitValidity(signedExit, false);
    const zigValidity = zigPre.getVoluntaryExitValidity(signedExit, false);
    expect(zigValidity).toEqual(tsValidity);
  });
});
