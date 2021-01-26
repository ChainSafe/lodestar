import {BeaconBlock} from "@chainsafe/lodestar-types";

import {processBlockHeader} from "./processBlockHeader";
import {processRandao} from "./processRandao";
import {processEth1Data} from "./processEth1Data";
import {processOperations} from "./processOperations";
import {processAttestation} from "./processAttestation";
import {processAttesterSlashing} from "./processAttesterSlashing";
import {processDeposit} from "./processDeposit";
import {processProposerSlashing} from "./processProposerSlashing";
import {processVoluntaryExit} from "./processVoluntaryExit";
import {CachedBeaconState} from "../util/cachedBeaconState";

export {
  processBlockHeader,
  processRandao,
  processEth1Data,
  processOperations,
  processAttestation,
  processAttesterSlashing,
  processDeposit,
  processProposerSlashing,
  processVoluntaryExit,
};

export function processBlock(cachedState: CachedBeaconState, block: BeaconBlock, verifySignatures = true): void {
  processBlockHeader(cachedState, block);
  processRandao(cachedState, block, verifySignatures);
  processEth1Data(cachedState, block.body);
  processOperations(cachedState, block.body, verifySignatures);
}
