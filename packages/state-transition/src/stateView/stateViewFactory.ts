import bindings from "@chainsafe/lodestar-z";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {getStateSlotFromBytes, getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {IBeaconStateView, IBeaconStateViewNative} from "./interface.js";
import {NativeBeaconStateView, assertNativeForkSupported} from "./nativeBeaconStateView.js";

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
    return createNativeBeaconStateView(opts.config, opts.stateBytes);
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
    return createNativeBeaconStateView(opts.config, opts.stateBytes);
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}

function createNativeBeaconStateView(config: BeaconConfig, stateBytes: Uint8Array): IBeaconStateView {
  assertNativeForkSupported(config, getStateSlotFromBytes(stateBytes));
  const nativeConfig = new bindings.BeaconConfig(config, config.genesisValidatorsRoot);
  return new NativeBeaconStateView(
    config,
    bindings.BeaconStateView.createFromBytes(stateBytes, nativeConfig) as IBeaconStateViewNative
  );
}
