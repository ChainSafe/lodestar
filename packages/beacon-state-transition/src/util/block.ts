import bls from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DOMAIN_BEACON_PROPOSER} from "@chainsafe/lodestar-params";
import {allForks} from "@chainsafe/lodestar-types";
import {getDomain} from "./domain";
import {computeSigningRoot} from "./signingRoot";

export function verifyBlockSignature(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  signedBlock: allForks.SignedBeaconBlock
): boolean {
  const domain = getDomain(state, DOMAIN_BEACON_PROPOSER);
  const blockType = config.getForkTypes(signedBlock.message.slot).BeaconBlock;
  const signingRoot = computeSigningRoot(blockType, signedBlock.message, domain);
  const proposer = state.validators[signedBlock.message.proposerIndex];
  return bls.verify(
    proposer.pubkey.valueOf() as Uint8Array,
    signingRoot,
    signedBlock.signature.valueOf() as Uint8Array
  );
}
