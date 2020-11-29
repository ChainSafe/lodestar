import bls from "@chainsafe/bls";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";

import {computeSigningRoot, getDomain} from "../../util";
import {DomainType} from "../../constants";
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
  return bls.Signature.fromBytes(signedBlock.signature.valueOf() as Uint8Array).verify(
    epochCtx.index2pubkey[signedBlock.message.proposerIndex],
    signingRoot
  );
}
