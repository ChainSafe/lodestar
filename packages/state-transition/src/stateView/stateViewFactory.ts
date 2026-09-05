import bindings from "@chainsafe/lodestar-z";
import {type PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BeaconConfig} from "@lodestar/config";
import {createCachedBeaconState} from "../cache/stateCache.js";
import {BeaconStateAllForks} from "../cache/types.js";
import {getStateSlotFromBytes, getStateTypeFromBytes} from "../util/sszBytes.js";
import {BeaconStateView} from "./beaconStateView.js";
import {assertNativeForkSupported} from "./errors.js";
import {IBeaconStateView} from "./interface.js";
import {NativeBeaconStateView} from "./nativeBeaconStateView.js";

export type StateViewFactory = Readonly<{
  native: boolean;
  createFromState(state: BeaconStateAllForks, stateBytes?: Uint8Array): IBeaconStateView;
  createFromBytes(stateBytes: Uint8Array): IBeaconStateView;
}>;

/**
 * Select the state implementation once during node or worker setup.
 * The caller must populate the shared pubkey cache before creating states.
 */
export function createStateViewFactory(
  config: BeaconConfig,
  pubkeyCache: PubkeyCache,
  {native = false}: {native?: boolean} = {}
): StateViewFactory {
  if (native) {
    const setup = new bindings.StateTransition(config, config.genesisValidatorsRoot);
    const createFromBytes = (stateBytes: Uint8Array): IBeaconStateView => {
      assertNativeForkSupported(config, getStateSlotFromBytes(stateBytes));
      return new NativeBeaconStateView(setup.createFromBytes(stateBytes), config);
    };
    return Object.freeze({
      native: true,
      createFromState(state: BeaconStateAllForks, stateBytes?: Uint8Array): IBeaconStateView {
        assertNativeForkSupported(config, state.slot);
        return createFromBytes(stateBytes ?? state.serialize());
      },
      createFromBytes,
    });
  }

  const createFromState = (state: BeaconStateAllForks): IBeaconStateView =>
    new BeaconStateView(createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncPubkeys: true}));
  return Object.freeze({
    native: false,
    createFromState,
    createFromBytes(stateBytes: Uint8Array): IBeaconStateView {
      return createFromState(getStateTypeFromBytes(config, stateBytes).deserializeToViewDU(stateBytes));
    },
  });
}
