import bindings from "@chainsafe/lodestar-z";
import {type PubkeyCache, pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {BeaconStateAllForks} from "../cache/types.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {IBeaconStateView, IBeaconStateViewNative} from "./interface.js";
import {NativeBeaconStateView} from "./nativeBeaconStateView.js";

// ---- createBeaconStateView (startup path) ----

type NodeJSOpts = {
  nativeStateTransition: false;
  anchorState: BeaconStateAllForks;
  config: BeaconConfig;
  pubkeyCache: PubkeyCache;
};

type NativeOpts = {
  nativeStateTransition: true;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from a pre-deserialized state. Used at node startup.
 *
 * The caller is responsible for creating and populating `pubkeyCache` (it is also
 * passed separately to BeaconNode.init, so it must live outside this factory).
 *
 * Set `nativeStateTransition: true` to use the native (Zig) implementation.
 */
export function createBeaconStateView(opts: NodeJSOpts | NativeOpts): IBeaconStateView {
  if (opts.nativeStateTransition) {
    return new NativeBeaconStateView(
      opts.config,
      bindings.BeaconStateView.createFromBytes(opts.stateBytes) as IBeaconStateViewNative
    );
  }
  const {anchorState, config, pubkeyCache} = opts;
  const cachedState = createCachedBeaconState(anchorState, {config, pubkeyCache}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}

// ---- createBeaconStateViewForHistoricalRegen (regen path) ----

type RegenNodeJSOpts = {
  nativeStateTransition: false;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

type RegenNativeOpts = {
  nativeStateTransition: true;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from raw SSZ bytes. Used in the historical state regen worker thread.
 *
 * Set `nativeStateTransition: true` to use the native (Zig) implementation.
 */
export function createBeaconStateViewForHistoricalRegen(opts: RegenNodeJSOpts | RegenNativeOpts): IBeaconStateView {
  if (opts.nativeStateTransition) {
    return new NativeBeaconStateView(
      opts.config,
      bindings.BeaconStateView.createFromBytes(opts.stateBytes) as IBeaconStateViewNative
    );
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}
