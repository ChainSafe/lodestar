import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {computeSigningRoot, getDomain, DomainType} from "@chainsafe/lodestar-beacon-state-transition";
import {Signature} from "@chainsafe/bls";
import {EpochContext} from "../index";

export function verifyBlockSignature(
  epochCtx: EpochContext,
  state: BeaconState,
  signedBlock: SignedBeaconBlock
): boolean {
  const domain = getDomain(epochCtx.config, state, DomainType.BEACON_PROPOSER);
  const signingRoot = computeSigningRoot(
    epochCtx.config,
    epochCtx.config.types.BeaconBlock,
    signedBlock.message,
    domain
  );
  return epochCtx.index2pubkey[signedBlock.message.proposerIndex].verifyMessage(
    Signature.fromCompressedBytes(signedBlock.signature.valueOf() as Uint8Array),
    signingRoot
  );
}
