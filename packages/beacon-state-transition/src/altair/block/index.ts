import {altair} from "@chainsafe/lodestar-types";

import {CachedBeaconStateAltair} from "../../types.js";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block/index.js";
import {processOperations} from "./processOperations.js";
import {processAttestations, RootCache} from "./processAttestation.js";
import {processAttesterSlashing} from "./processAttesterSlashing.js";
import {processDeposit} from "./processDeposit.js";
import {processProposerSlashing} from "./processProposerSlashing.js";
import {processVoluntaryExit} from "./processVoluntaryExit.js";
import {processSyncAggregate} from "./processSyncCommittee.js";

export {
  processOperations,
  processAttestations,
  RootCache,
  processAttesterSlashing,
  processDeposit,
  processProposerSlashing,
  processVoluntaryExit,
  processSyncAggregate,
};

export function processBlock(state: CachedBeaconStateAltair, block: altair.BeaconBlock, verifySignatures = true): void {
  processBlockHeader(state, block);
  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(state, block.body, verifySignatures);
  processSyncAggregate(state, block, verifySignatures);
}
