import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {computeSigningRoot} from "./signingRoot";

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  signedBlock: phase0.SignedBeaconBlock
): boolean {
  const domain = getDomain(config, state as phase0.BeaconState, config.params.DOMAIN_BEACON_PROPOSER);
  const signingRoot = computeSigningRoot(config, config.types.phase0.BeaconBlock, signedBlock.message, domain);
  const proposer = state.validators[signedBlock.message.proposerIndex];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedBlock.signature.valueOf() as Uint8Array
  );
}
