import {BeaconConfig} from "@lodestar/config";
import {LodestarError} from "@lodestar/utils";
import {PubkeyCache, createPubkeyCache} from "../cache/pubkeyCache.js";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {BeaconStateAllForks} from "../cache/types.js";
import {getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {IBeaconStateView} from "./interface.js";

export enum NativeStateViewErrorCode {
  NOT_IMPLEMENTED = "NATIVE_STATE_VIEW_NOT_IMPLEMENTED",
}

export type NativeStateViewContext = "beacon startup" | "historical state regeneration";

export type NativeStateViewErrorType = {
  code: NativeStateViewErrorCode.NOT_IMPLEMENTED;
  context: NativeStateViewContext;
};

export class NativeStateViewError extends LodestarError<NativeStateViewErrorType> {}

export function createNativeStateViewError(context: NativeStateViewContext): NativeStateViewError {
  return new NativeStateViewError(
    {code: NativeStateViewErrorCode.NOT_IMPLEMENTED, context},
    `Native (Zig) BeaconStateView is not implemented for ${context}. Disable --chain.nativeStateView and retry.`
  );
}

export function assertNativeStateViewSupported(useNative: boolean, context: NativeStateViewContext): void {
  if (useNative) {
    throw createNativeStateViewError(context);
  }
}

// ---- createBeaconStateView (startup path) ----

type NodeJSOpts = {
  useNative: false;
  anchorState: BeaconStateAllForks;
  config: BeaconConfig;
  pubkeyCache: PubkeyCache;
};

type NativeOpts = {
  useNative: true;
  stateBytes: Uint8Array;
};

/**
 * Create a BeaconStateView from a pre-deserialized state. Used at node startup.
 *
 * The caller is responsible for creating and populating `pubkeyCache` (it is also
 * passed separately to BeaconNode.init, so it must live outside this factory).
 *
 * Set `useNative: true` to use the native (Zig) implementation once available.
 */
export function createBeaconStateView(opts: NodeJSOpts | NativeOpts): IBeaconStateView {
  if (opts.useNative) {
    throw createNativeStateViewError("beacon startup");
  }
  const {anchorState, config, pubkeyCache} = opts;
  const cachedState = createCachedBeaconState(anchorState, {config, pubkeyCache}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}

// ---- createBeaconStateViewForHistoricalRegen (regen path) ----

// Reused across all historical state regen calls in the worker thread
const pubkeyCacheRegen = createPubkeyCache();

function syncPubkeyCache(state: BeaconStateAllForks, pubkeyCache: PubkeyCache): void {
  const newCount = state.validators.length;
  for (let i = pubkeyCache.size; i < newCount; i++) {
    const pubkey = state.validators.getReadonly(i).pubkey;
    pubkeyCache.set(i, pubkey);
  }
}

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
    throw createNativeStateViewError("historical state regeneration");
  }
  const {config, stateBytes} = opts;
  const state = getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes);
  syncPubkeyCache(state, pubkeyCacheRegen);
  const cachedState = createCachedBeaconState(state, {config, pubkeyCache: pubkeyCacheRegen}, {skipSyncPubkeys: true});
  return new BeaconStateView(cachedState);
}
