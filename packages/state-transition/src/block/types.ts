export interface ProcessBlockOpts {
  verifySignatures?: boolean;
}

export enum ProposerRewardType {
  attestation = "attestation",
  syncAggregate = "sync_aggregate",
  slashing = "slashing",
}

/**
 * Steps of `processBlock()` tracked in metrics
 */
export enum BlockProcessStep {
  processParentExecutionPayload = "processParentExecutionPayload",
  processBlockHeader = "processBlockHeader",
  processWithdrawals = "processWithdrawals",
  processExecutionPayload = "processExecutionPayload",
  processExecutionPayloadBid = "processExecutionPayloadBid",
  processRandao = "processRandao",
  processEth1Data = "processEth1Data",
  processOperations = "processOperations",
  processSyncAggregate = "processSyncAggregate",
  processBlobKzgCommitments = "processBlobKzgCommitments",
}

/**
 * Steps of `processOperations()` tracked in metrics
 */
export enum ProcessOperationsStep {
  processProposerSlashing = "processProposerSlashing",
  processAttesterSlashing = "processAttesterSlashing",
  processAttestations = "processAttestations",
  processDeposit = "processDeposit",
  processVoluntaryExit = "processVoluntaryExit",
  processBlsToExecutionChange = "processBlsToExecutionChange",
  processDepositRequest = "processDepositRequest",
  processWithdrawalRequest = "processWithdrawalRequest",
  processConsolidationRequest = "processConsolidationRequest",
  processPayloadAttestation = "processPayloadAttestation",
}
