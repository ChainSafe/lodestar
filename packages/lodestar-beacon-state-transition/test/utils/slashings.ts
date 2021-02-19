import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0} from "@chainsafe/lodestar-types";
import {generateEmptyBlock} from "./block";
import {getTemporaryBlockHeader} from "../../src/util/blockRoot";
import {generateEmptyAttestation} from "./attestation";

export function generateEmptyProposerSlashing(): phase0.ProposerSlashing {
  return {
    signedHeader1: {message: getTemporaryBlockHeader(config, generateEmptyBlock()), signature: Buffer.alloc(96)},
    signedHeader2: {message: getTemporaryBlockHeader(config, generateEmptyBlock()), signature: Buffer.alloc(96)},
  };
}

export function generateEmptyAttesterSlashing(): phase0.AttesterSlashing {
  return {
    attestation1: {
      data: generateEmptyAttestation().data,
      signature: generateEmptyAttestation().signature,
      attestingIndices: ([] as number[]) as List<number>,
    },
    attestation2: {
      data: generateEmptyAttestation().data,
      signature: generateEmptyAttestation().signature,
      attestingIndices: ([] as number[]) as List<number>,
    },
  };
}
