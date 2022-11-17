import {ForkSeq} from "@lodestar/params";
import {allForks, altair, eip4844} from "@lodestar/types";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {CachedBeaconStateAllForks, CachedBeaconStateBellatrix} from "../types.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processOperations} from "./processOperations.js";
import {processRandao} from "./processRandao.js";
import {processBlobKzgCommitments} from "./processBlobKzgCommitments.js";
import {BlockExternalData, DataAvailableStatus} from "./externalData.js";

// Spec tests
export {processBlockHeader, processExecutionPayload, processRandao, processEth1Data, processSyncAggregate};
export * from "./processOperations.js";

export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";
export * from "./externalData.js";

export function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock,
  externalData: BlockExternalData,
  verifySignatures = true
): void {
  processBlockHeader(state, block);

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (fork >= ForkSeq.bellatrix) {
    const fullOrBlindedPayload = getFullOrBlindedPayload(block);

    if (isExecutionEnabled(state as CachedBeaconStateBellatrix, block)) {
      processExecutionPayload(fork, state as CachedBeaconStateBellatrix, fullOrBlindedPayload, externalData);
    }
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(fork, state, block.body, verifySignatures);
  if (fork >= ForkSeq.altair) {
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
  }

  if (fork >= ForkSeq.eip4844) {
    processBlobKzgCommitments(block.body as eip4844.BeaconBlockBody);

    // New in EIP-4844, note: Can sync optimistically without this condition, see note on `is_data_available`
    // NOTE: Ommitted and should be verified beforehand

    // assert is_data_available(block.slot, hash_tree_root(block), block.body.blob_kzg_commitments)
    switch (externalData.dataAvailableStatus) {
      case DataAvailableStatus.preEIP4844:
        throw Error("dataAvailableStatus preEIP4844");
      case DataAvailableStatus.notAvailable:
        throw Error("dataAvailableStatus notAvailable");
      case DataAvailableStatus.available:
        break; // ok
    }
  }
}
