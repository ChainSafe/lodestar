import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {AttesterSlashing, ProposerSlashing} from "@chainsafe/eth2.0-types";
import {generateEmptyBlock} from "./block";
import {getTemporaryBlockHeader} from "@chainsafe/eth2.0-state-transition";
import {generateEmptyAttestation} from "./attestation";


export function generateEmptyProposerSlashing(): ProposerSlashing {

  return {
    header1: getTemporaryBlockHeader(config, generateEmptyBlock()),
    header2: getTemporaryBlockHeader(config, generateEmptyBlock()),
    proposerIndex: 0
  };
}

export function generateEmptyAttesterSlashing(): AttesterSlashing {

  return {
    attestation1: {
      data: generateEmptyAttestation().data,
      signature: generateEmptyAttestation().signature,
      custodyBit1Indices: [],
      custodyBit0Indices: [0],
    },
    attestation2: {
      data: generateEmptyAttestation().data,
      signature: generateEmptyAttestation().signature,
      custodyBit1Indices: [],
      custodyBit0Indices: [0],
    },
  };
}
