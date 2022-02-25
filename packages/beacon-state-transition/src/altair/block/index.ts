import {altair} from "@chainsafe/lodestar-types";

import {processOperations} from "./processOperations";
import {processAttestations, RootCache} from "./processAttestation";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processDeposit} from "./processDeposit";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {processSyncAggregate} from "./processSyncCommittee";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {CachedBeaconStateAltair, CachedBeaconStateAllForks} from "../../types";

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
  processBlockHeader(state as CachedBeaconStateAllForks, block);
  processRandao(state as CachedBeaconStateAllForks, block, verifySignatures);
  processEth1Data(state as CachedBeaconStateAllForks, block.body);
  processOperations(state, block.body, verifySignatures);
  processSyncAggregate(state, block, verifySignatures);
}
