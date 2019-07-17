import {AttesterSlashing, ProposerSlashing} from "@chainsafe/eth2-types";
import {generateEmptyBlock} from "./block";
import {getTemporaryBlockHeader} from "../../src/chain/stateTransition/util";
import {generateEmptyAttestation} from "./attestation";
import {createIBeaconConfig} from "../../src/config";
import * as mainnetParams from "../../src/params/presets/mainnet";

let config = createIBeaconConfig(mainnetParams);

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
      custodyBit1Indices: [0],
      custodyBit0Indices: [0],
    },
    attestation2: {
      data: generateEmptyAttestation().data,
      signature: generateEmptyAttestation().signature,
      custodyBit1Indices: [0],
      custodyBit0Indices: [0],
    },
  };
}
