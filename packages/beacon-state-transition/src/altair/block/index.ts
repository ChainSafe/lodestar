import {allForks, altair} from "@chainsafe/lodestar-types";

import {CachedBeaconState} from "../../allForks/util";
import {processBlockHeader, processEth1Data, processRandao} from "../../allForks/block";
import {processOperations} from "./processOperations";
import {processAttestations} from "./processAttestation";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processDeposit} from "./processDeposit";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {processSyncAggregate} from "./processSyncCommittee";
import {BlockProcess} from "../../util";

export {
  processOperations,
  processAttestations,
  processAttesterSlashing,
  processDeposit,
  processProposerSlashing,
  processVoluntaryExit,
  processSyncAggregate,
};

export function processBlock(
  state: CachedBeaconState<altair.BeaconState>,
  block: altair.BeaconBlock,
  verifySignatures = true
): void {
  const blockProcess: BlockProcess = {};
  processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, block);
  processRandao(state as CachedBeaconState<allForks.BeaconState>, block, verifySignatures);
  processEth1Data(state as CachedBeaconState<allForks.BeaconState>, block.body);
  processOperations(state, block.body, blockProcess, verifySignatures);
  processSyncAggregate(state, block, verifySignatures);
}
