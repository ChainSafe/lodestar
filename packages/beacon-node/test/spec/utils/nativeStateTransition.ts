import bindings from "@chainsafe/lodestar-z";
import {CachedBeaconStateAllForks, IBeaconStateViewNative, StateTransitionOpts} from "@lodestar/state-transition";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, isBlindedBeaconBlock} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";

export class NativeStateTransitionRunner {
  private nativeView: IBeaconStateViewNative;

  constructor(private readonly seedState: CachedBeaconStateAllForks) {
    bindings.config.set(seedState.config, seedState.genesisValidatorsRoot);
    this.nativeView = bindings.BeaconStateView.createFromBytes(seedState.serialize()) as IBeaconStateViewNative;
  }

  stateTransition(signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock, options: StateTransitionOpts): void {
    const blockBytes = serializeNativeSignedBlock(this.seedState, signedBlock);
    this.nativeView = this.nativeView.stateTransition(blockBytes, options);
  }

  toCachedState(): CachedBeaconStateAllForks {
    const postStateBytes = this.nativeView.serialize();
    const postState = this.seedState.config
      .getForkTypes(this.nativeView.slot)
      .BeaconState.deserializeToViewDU(postStateBytes);
    return createCachedBeaconStateTest(postState, this.seedState.config) as CachedBeaconStateAllForks;
  }
}

export function createNativeStateTransitionRunner(state: CachedBeaconStateAllForks): NativeStateTransitionRunner {
  return new NativeStateTransitionRunner(state);
}

function serializeNativeSignedBlock(
  state: CachedBeaconStateAllForks,
  signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock
): Uint8Array {
  const blockSlot = signedBlock.message.slot;
  if (isBlindedBeaconBlock(signedBlock.message)) {
    return state.config
      .getPostBellatrixForkTypes(blockSlot)
      .SignedBlindedBeaconBlock.serialize(signedBlock as SignedBlindedBeaconBlock);
  }

  return state.config.getForkTypes(blockSlot).SignedBeaconBlock.serialize(signedBlock as SignedBeaconBlock);
}
