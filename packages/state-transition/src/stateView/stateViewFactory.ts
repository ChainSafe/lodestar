import bindings from "@chainsafe/lodestar-z";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {IBeaconStateView, IBeaconStateViewNative} from "./interface.js";
import {NativeBeaconStateView} from "./nativeBeaconStateView.js";

// ---- createBeaconStateView (startup path) ----

type CreateBeaconStateViewOpts = {
  nativeStateTransition: boolean;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from raw SSZ bytes. Used at node startup.
 *
 * Caller must reserve pubkey capacity before calling this function.
 *
 * Set `nativeStateTransition: true` to use the native (Zig) implementation.
 */
export function createBeaconStateView(opts: CreateBeaconStateViewOpts): IBeaconStateView {
  if (opts.nativeStateTransition) {
    return new NativeBeaconStateView(
      opts.config,
      bindings.BeaconStateView.createFromBytes(opts.stateBytes) as IBeaconStateViewNative
    );
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: false});
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
