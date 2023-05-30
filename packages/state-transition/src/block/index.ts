import {ForkSeq} from "@lodestar/params";
import {allForks, altair, capella, deneb} from "@lodestar/types";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {CachedBeaconStateAllForks, CachedBeaconStateCapella, CachedBeaconStateBellatrix} from "../types.js";
import {processExecutionPayload} from "./process_execution_payload.js";
import {processSyncAggregate} from "./process_sync_committee.js";
import {processBlockHeader} from "./process_block_header.js";
import {processEth1Data} from "./process_eth1_data.js";
import {processOperations} from "./process_operations.js";
import {processRandao} from "./process_randao.js";
import {processBlobKzgCommitments} from "./process_blob_kzg_commitments.js";
import {BlockExternalData, DataAvailableStatus} from "./external_data.js";
import {processWithdrawals} from "./process_withdrawals.js";
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
export * from "./process_operations.js";

export * from "./initiate_validator_exit.js";
export * from "./is_valid_indexed_attestation.js";
export * from "./external_data.js";

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
    // Only throw preDeneb so beacon can also sync/process blocks optimistically
    // and let forkChoice handle it
    if (externalData.dataAvailableStatus === DataAvailableStatus.preDeneb) {
      throw Error("dataAvailableStatus preDeneb");
    }
  }
}
