import {ForkSeq} from "@lodestar/params";
import {allForks, altair, capella, deneb} from "@lodestar/types";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {CachedBeaconStateAllForks, CachedBeaconStateCapella, CachedBeaconStateBellatrix} from "../types.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processOperations} from "./processOperations.js";
import {processRandao} from "./processRandao.js";
import {processBlobKzgCommitments} from "./processBlobKzgCommitments.js";
import {BlockExternalData, DataAvailableStatus} from "./externalData.js";
import {processWithdrawals} from "./processWithdrawals.js";
import {ProcessBlockOpts} from "./types.js";

// Spec tests
export {
  processBlockHeader,
  processExecutionPayload,
  processRandao,
  processEth1Data,
  processSyncAggregate,
  processWithdrawals,
};
export * from "./processOperations.js";

export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";
export * from "./externalData.js";

export function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock,
  externalData: BlockExternalData & ProcessBlockOpts,
  opts?: ProcessBlockOpts
): void {
  const {verifySignatures = true} = opts ?? {};

  processBlockHeader(state, block);

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (fork >= ForkSeq.bellatrix && isExecutionEnabled(state as CachedBeaconStateBellatrix, block)) {
    const fullOrBlindedPayload = getFullOrBlindedPayload(block);
    // TODO Deneb: Allow to disable withdrawals for interop testing
    // https://github.com/ethereum/consensus-specs/blob/b62c9e877990242d63aa17a2a59a49bc649a2f2e/specs/eip4844/beacon-chain.md#disabling-withdrawals
    if (fork >= ForkSeq.capella) {
      processWithdrawals(
        state as CachedBeaconStateCapella,
        fullOrBlindedPayload as capella.FullOrBlindedExecutionPayload
      );
    }
    processExecutionPayload(fork, state as CachedBeaconStateBellatrix, fullOrBlindedPayload, externalData);
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(fork, state, block.body, opts);
  if (fork >= ForkSeq.altair) {
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
  }

  if (fork >= ForkSeq.deneb) {
    processBlobKzgCommitments(block.body as deneb.BeaconBlockBody);

    // New in Deneb, note: Can sync optimistically without this condition, see note on `is_data_available`
    // NOTE: Ommitted and should be verified beforehand

    // assert is_data_available(block.slot, hash_tree_root(block), block.body.blob_kzg_commitments)
    switch (externalData.dataAvailableStatus) {
      case DataAvailableStatus.preDeneb:
        throw Error("dataAvailableStatus preDeneb");
      case DataAvailableStatus.notAvailable:
        throw Error("dataAvailableStatus notAvailable");
      case DataAvailableStatus.available:
        break; // ok
    }
  }
}
