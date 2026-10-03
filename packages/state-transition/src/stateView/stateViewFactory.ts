import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {IBeaconStateView} from "./interface.js";

// ---- createBeaconStateView (startup path) ----

type CreateBeaconStateViewOpts = {
  useNative: boolean;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from raw SSZ bytes. Used at node startup.
 *
 * Caller must reserve pubkey capacity before calling this function.
 *
 * Set `useNative: true` to use the native (Zig) implementation once available.
 */
export function createBeaconStateView(opts: CreateBeaconStateViewOpts): IBeaconStateView {
  if (opts.useNative) {
    throw new Error("Native (Zig) BeaconStateView not yet implemented");
    // TODO: return a new instance of NativeBeaconStateView
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: false});
  return new BeaconStateView(cachedState);
}

// ---- createBeaconStateViewForHistoricalRegen (regen path) ----

type RegenNodeJSOpts = {
  useNative: false;
  config: BeaconConfig;
  stateBytes: Uint8Array;
};

type RegenNativeOpts = {
  useNative: true;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from raw SSZ bytes. Used in the historical state regen worker thread.
 *
 * Set `useNative: true` to use the native (Zig) implementation once available.
 */
export function createBeaconStateViewForHistoricalRegen(opts: RegenNodeJSOpts | RegenNativeOpts): IBeaconStateView {
  if (opts.useNative) {
    throw new Error("Native (Zig) BeaconStateView not yet implemented");
    // TODO: return a new instance of NativeBeaconStateView
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}
