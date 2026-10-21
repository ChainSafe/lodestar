import {VerifyBlocksOpts} from "../beaconEngine/interface.js";
import type {BeaconChain} from "../chain.js";
import {IBlockInput} from "./blockInput/index.js";
import {verifyBlocksDataAvailability} from "./verifyBlocksDataAvailability.js";

/**
 * API broadcast validation does not prepare an import. The later processBlock call verifies again
 * with the EL and retains its own bundle. In particular, rejecting publication for equivocation
 * must leave no post-state behind and must not discard a concurrent import's verification result.
 */
export async function validateApiBlock(
  this: BeaconChain,
  blockInput: IBlockInput,
  opts: VerifyBlocksOpts
): Promise<void> {
  const abortController = new AbortController();
  try {
    await Promise.all([
      verifyBlocksDataAvailability([blockInput], abortController.signal),
      this.beaconEngine.validateApiBlock(blockInput, opts),
    ]);
  } finally {
    abortController.abort();
  }
}
