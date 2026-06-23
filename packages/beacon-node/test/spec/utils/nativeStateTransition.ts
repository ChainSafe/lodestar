import bindings from "@chainsafe/lodestar-z";
import {CachedBeaconStateAllForks, IBeaconStateViewNative, StateTransitionOpts} from "@lodestar/state-transition";
import {SignedBeaconBlock, SignedBlindedBeaconBlock, isBlindedBeaconBlock} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";

/**
 * Spec-test-only native transition toggle.
 *
 * Production native selection is made by constructing the initial `IBeaconStateView`
 * at boot. Spec tests still start from SSZ fixtures so we need a environment variable to opt
 * into the native runner.
 */
export const useNativeStateTransition = process.env.LODESTAR_NATIVE_STF === "true";

/**
 * Runs multi-block spec fixtures through one native state instance.
 *
 * This runner creates the native view once, applies all blocks in
 * native, and only converts back to a Lodestar cached state for the final
 * spec-state comparison.
 *
 * NOTE: This should only be used for tests.
 */
export class NativeStateTransitionRunner {
  private nativeView: IBeaconStateViewNative;

  constructor(private readonly seedState: CachedBeaconStateAllForks) {
    bindings.config.set(seedState.config, seedState.genesisValidatorsRoot);
    this.nativeView = bindings.BeaconStateView.createFromBytes(seedState.serialize()) as IBeaconStateViewNative;
  }

  /**
   * Applies one fixture block to the current native state.
   *
   * Blocks are still loaded by Lodestar's spec harness as typed SSZ values, so
   * this method serializes the block before crossing the N-API boundary.
   */
  stateTransition(signedBlock: SignedBeaconBlock | SignedBlindedBeaconBlock, options: StateTransitionOpts): void {
    const blockBytes = serializeNativeSignedBlock(this.seedState, signedBlock);
    this.nativeView = this.nativeView.stateTransition(blockBytes, options);
  }

  /**
   * Converts the final native state back into a Lodestar cached state for spec assertions.
   */
  toCachedState(): CachedBeaconStateAllForks {
    // Spec comparison helpers expect Lodestar cached states, so convert once after the fixture's block sequence.
    const postStateBytes = this.nativeView.serialize();
    const postState = this.seedState.config
      .getForkTypes(this.nativeView.slot)
      .BeaconState.deserializeToViewDU(postStateBytes);
    return createCachedBeaconStateTest(postState, this.seedState.config) as CachedBeaconStateAllForks;
  }
}

/**
 * Creates a native transition runner seeded from a Lodestar cached state fixture.
 */
export function createNativeStateTransitionRunner(state: CachedBeaconStateAllForks): NativeStateTransitionRunner {
  return new NativeStateTransitionRunner(state);
}

/**
 * Serializes full and blinded signed blocks with the SSZ type matching the block slot.
 */
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
