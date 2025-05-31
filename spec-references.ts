/**
 * CENTRALIZED ETHSPECIFY TAGS
 * 
 * This file maps Lodestar code components to Ethereum specification references.
 * No markers or comments are needed in the actual implementation files.
 * 
 * Each entry contains:
 * 1. A component identifier (e.g., class name, function name)
 * 2. The corresponding ethspecify tag
 * 3. Optionally, a file path for reference (not used by ethspecify)
 */

export const SpecReferences = [
  // Functions
  /**
   * @SPEC compute_fork_digest
   */
  {
    component: "compute_fork_digest",
    filePath: "packages/state-transition/src/util/fork.ts",
    specTag: `<spec fn="compute_fork_digest" hash="8b33f64d" />`
  },
  /**
   * @SPEC compute_fork_version
   */
  {
    component: "compute_fork_version",
    filePath: "packages/state-transition/src/util/fork.ts",
    specTag: `<spec fn="compute_fork_version" hash="6d472038" />`
  },
  /**
   * @SPEC compute_proposer_index
   */
  {
    component: "compute_proposer_index",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="compute_proposer_index" hash="74c8109d" />`
  },
  /**
   * @SPEC get_attesting_indices
   */
  {
    component: "get_attesting_indices",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="get_attesting_indices" hash="3304d67e" />`
  },
  /**
   * @SPEC get_beacon_committee
   */
  {
    component: "get_beacon_committee",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="get_beacon_committee" hash="f04db100" />`
  },
  /**
   * @SPEC get_max_blobs_per_block
   */
  {
    component: "get_max_blobs_per_block",
    filePath: "packages/state-transition/src/util/blobs.ts",
    specTag: `<spec fn="get_max_blobs_per_block" hash="3521ad35" />`
  },
  /**
   * @SPEC get_max_effective_balance
   */
  {
    component: "get_max_effective_balance",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="get_max_effective_balance" hash="77f96872" />`
  },
  /**
   * @SPEC prepare_execution_payload
   */
  {
    component: "prepare_execution_payload",
    filePath: "packages/state-transition/src/block/execution.ts",
    specTag: `<spec fn="prepare_execution_payload" hash="ea67dc0d" />`
  },
  /**
   * @SPEC process_attestation
   */
  {
    component: "process_attestation",
    filePath: "packages/state-transition/src/block/processAttestation.ts",
    specTag: `<spec fn="process_attestation" hash="ac9b7566" />`
  },
  /**
   * @SPEC process_attester_slashing
   */
  {
    component: "process_attester_slashing",
    filePath: "packages/state-transition/src/block/processAttesterSlashing.ts",
    specTag: `<spec fn="process_attester_slashing" hash="52b53198" />`
  },
  /**
   * @SPEC process_block
   */
  {
    component: "process_block",
    filePath: "packages/state-transition/src/block/index.ts",
    specTag: `<spec fn="process_block" hash="a30c9ad3" />`
  },
  /**
   * @SPEC process_block_header
   */
  {
    component: "process_block_header",
    filePath: "packages/state-transition/src/block/processBlockHeader.ts",
    specTag: `<spec fn="process_block_header" hash="53fd0b1a" />`
  },
  /**
   * @SPEC process_consolidation_request
   */
  {
    component: "process_consolidation_request",
    filePath: "packages/state-transition/src/block/processConsolidationRequest.ts",
    specTag: `<spec fn="process_consolidation_request" hash="d1802f07" />`
  },
  /**
   * @SPEC process_deposit
   */
  {
    component: "process_deposit",
    filePath: "packages/state-transition/src/block/processDeposit.ts",
    specTag: `<spec fn="process_deposit" hash="a74bd5ef" />`
  },
  /**
   * @SPEC process_deposit_request
   */
  {
    component: "process_deposit_request",
    filePath: "packages/state-transition/src/block/processDepositRequest.ts",
    specTag: `<spec fn="process_deposit_request" hash="5f0a91a2" />`
  },
  /**
   * @SPEC process_effective_balance_updates
   */
  {
    component: "process_effective_balance_updates",
    filePath: "packages/state-transition/src/epoch/processEffectiveBalanceUpdates.ts",
    specTag: `<spec fn="process_effective_balance_updates" hash="ab5e4c4c" />`
  },
  /**
   * @SPEC process_epoch
   */
  {
    component: "process_epoch",
    filePath: "packages/state-transition/src/epoch/index.ts",
    specTag: `<spec fn="process_epoch" hash="771a9cad" />`
  },
  /**
   * @SPEC process_execution_payload
   */
  {
    component: "process_execution_payload",
    filePath: "packages/state-transition/src/block/processExecutionPayload.ts",
    specTag: `<spec fn="process_execution_payload" hash="695ef30e" />`
  },
  /**
   * @SPEC process_justification_and_finalization
   */
  {
    component: "process_justification_and_finalization",
    filePath: "packages/state-transition/src/epoch/processJustificationAndFinalization.ts",
    specTag: `<spec fn="process_justification_and_finalization" hash="4d8d34d0" />`
  },
  /**
   * @SPEC process_light_client_finality_update
   */
  {
    component: "process_light_client_finality_update",
    filePath: "packages/state-transition/src/block/processLightClientFinalityUpdate.ts",
    specTag: `<spec fn="process_light_client_finality_update" hash="387eeb1d" />`
  },
  /**
   * @SPEC process_light_client_optimistic_update
   */
  {
    component: "process_light_client_optimistic_update",
    filePath: "packages/state-transition/src/block/processLightClientOptimisticUpdate.ts",
    specTag: `<spec fn="process_light_client_optimistic_update" hash="088e97c1" />`
  },
  /**
   * @SPEC process_light_client_store_force_update
   */
  {
    component: "process_light_client_store_force_update",
    filePath: "packages/state-transition/src/block/processLightClientStoreForceUpdate.ts",
    specTag: `<spec fn="process_light_client_store_force_update" hash="2e537c22" />`
  },
  /**
   * @SPEC process_light_client_update
   */
  {
    component: "process_light_client_update",
    filePath: "packages/state-transition/src/block/processLightClientUpdate.ts",
    specTag: `<spec fn="process_light_client_update" hash="0e9d049d" />`
  },
  /**
   * @SPEC process_operations
   */
  {
    component: "process_operations",
    filePath: "packages/state-transition/src/block/processOperations.ts",
    specTag: `<spec fn="process_operations" hash="fae5e580" />`
  },
  /**
   * @SPEC process_pending_consolidations
   */
  {
    component: "process_pending_consolidations",
    filePath: "packages/state-transition/src/block/processPendingConsolidations.ts",
    specTag: `<spec fn="process_pending_consolidations" hash="1d328e17" />`
  },
  /**
   * @SPEC process_pending_deposits
   */
  {
    component: "process_pending_deposits",
    filePath: "packages/state-transition/src/block/processPendingDeposits.ts",
    specTag: `<spec fn="process_pending_deposits" hash="773298bd" />`
  },
  /**
   * @SPEC process_proposer_slashing
   */
  {
    component: "process_proposer_slashing",
    filePath: "packages/state-transition/src/block/processProposerSlashing.ts",
    specTag: `<spec fn="process_proposer_slashing" hash="0f11acaf" />`
  },
  /**
   * @SPEC process_randao
   */
  {
    component: "process_randao",
    filePath: "packages/state-transition/src/block/processRandao.ts",
    specTag: `<spec fn="process_randao" hash="0109972b" />`
  },
  /**
   * @SPEC process_registry_updates
   */
  {
    component: "process_registry_updates",
    filePath: "packages/state-transition/src/epoch/processRegistryUpdates.ts",
    specTag: `<spec fn="process_registry_updates" hash="00c97a64" />`
  },
  /**
   * @SPEC process_rewards_and_penalties
   */
  {
    component: "process_rewards_and_penalties",
    filePath: "packages/state-transition/src/epoch/processRewardsAndPenalties.ts",
    specTag: `<spec fn="process_rewards_and_penalties" hash="1e870ebc" />`
  },
  /**
   * @SPEC process_slashings
   */
  {
    component: "process_slashings",
    filePath: "packages/state-transition/src/epoch/processSlashings.ts",
    specTag: `<spec fn="process_slashings" hash="ec8aa896" />`
  },
  /**
   * @SPEC process_slot
   */
  {
    component: "process_slot",
    filePath: "packages/state-transition/src/block/processSlot.ts",
    specTag: `<spec fn="process_slot" hash="fd0bdca5" />`
  },
  /**
   * @SPEC process_sync_aggregate
   */
  {
    component: "process_sync_aggregate",
    filePath: "packages/state-transition/src/block/processSyncAggregate.ts",
    specTag: `<spec fn="process_sync_aggregate" hash="f31b8b9c" />`
  },
  /**
   * @SPEC process_sync_committee_contributions
   */
  {
    component: "process_sync_committee_contributions",
    filePath: "packages/state-transition/src/block/processSyncCommitteeContributions.ts",
    specTag: `<spec fn="process_sync_committee_contributions" hash="cc848e7c" />`
  },
  /**
   * @SPEC process_sync_committee_updates
   */
  {
    component: "process_sync_committee_updates",
    filePath: "packages/state-transition/src/epoch/processSyncCommitteeUpdates.ts",
    specTag: `<spec fn="process_sync_committee_updates" hash="9e59de37" />`
  },
  /**
   * @SPEC process_voluntary_exit
   */
  {
    component: "process_voluntary_exit",
    filePath: "packages/state-transition/src/block/processVoluntaryExit.ts",
    specTag: `<spec fn="process_voluntary_exit" hash="3ee83868" />`
  },
  /**
   * @SPEC process_withdrawal_request
   */
  {
    component: "process_withdrawal_request",
    filePath: "packages/state-transition/src/block/processWithdrawalRequest.ts",
    specTag: `<spec fn="process_withdrawal_request" hash="76c75ae8" />`
  },
  /**
   * @SPEC process_withdrawals
   */
  {
    component: "process_withdrawals",
    filePath: "packages/state-transition/src/block/processWithdrawals.ts",
    specTag: `<spec fn="process_withdrawals" hash="3527c68c" />`
  },
  /**
   * @SPEC state_transition
   */
  {
    component: "state_transition",
    filePath: "packages/state-transition/src/index.ts",
    specTag: `<spec fn="state_transition" hash="356909b9" />`
  },

  // SSZ Objects
  /**
   * @SPEC AggregateAndProof
   */
  {
    component: "AggregateAndProof",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="AggregateAndProof" hash="a218764f" />`
  },
  /**
   * @SPEC Attestation
   */
  {
    component: "Attestation",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="Attestation" hash="a1de4d5b" />`
  },
  /**
   * @SPEC BeaconBlock
   */
  {
    component: "BeaconBlock",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlock" hash="79909f0a" />`
  },
  /**
   * @SPEC BeaconBlockBody
   */
  {
    component: "BeaconBlockBody",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlockBody" hash="7c054a64" />`
  },
  /**
   * @SPEC BeaconBlockHeader
   */
  {
    component: "BeaconBlockHeader",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlockHeader" hash="0be4f2e7" />`
  },
  /**
   * @SPEC BeaconState
   */
  {
    component: "BeaconState",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" hash="910d0f39" />`
  },
  /**
   * @SPEC ExecutionPayload
   */
  {
    component: "ExecutionPayload",
    filePath: "packages/types/src/bellatrix/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionPayload" hash="3c96a4a7" />`
  },
  /**
   * @SPEC ExecutionPayloadHeader
   */
  {
    component: "ExecutionPayloadHeader",
    filePath: "packages/types/src/bellatrix/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionPayloadHeader" hash="438d9b8b" />`
  },
  /**
   * @SPEC ExecutionRequests
   */
  {
    component: "ExecutionRequests",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionRequests" hash="5b530db0" />`
  },
  /**
   * @SPEC LightClientBootstrap
   */
  {
    component: "LightClientBootstrap",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientBootstrap" hash="1e7a218b" />`
  },
  /**
   * @SPEC LightClientFinalityUpdate
   */
  {
    component: "LightClientFinalityUpdate",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientFinalityUpdate" hash="85006d6b" />`
  },
  /**
   * @SPEC LightClientHeader
   */
  {
    component: "LightClientHeader",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientHeader" hash="a99c9471" />`
  },
  /**
   * @SPEC LightClientOptimisticUpdate
   */
  {
    component: "LightClientOptimisticUpdate",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientOptimisticUpdate" hash="c5493784" />`
  },
  /**
   * @SPEC LightClientUpdate
   */
  {
    component: "LightClientUpdate",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientUpdate" hash="9c59b062" />`
  },
  /**
   * @SPEC SingleAttestation
   */
  {
    component: "SingleAttestation",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SingleAttestation" hash="f67f746a" />`
  },
  /**
   * @SPEC SyncAggregate
   */
  {
    component: "SyncAggregate",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncAggregate" hash="51e247e5" />`
  },
  /**
   * @SPEC SyncAggregatorSelectionData
   */
  {
    component: "SyncAggregatorSelectionData",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncAggregatorSelectionData" hash="990a8a7f" />`
  },
  /**
   * @SPEC SyncCommittee
   */
  {
    component: "SyncCommittee",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommittee" hash="b1d52376" />`
  },
  /**
   * @SPEC SyncCommitteeContribution
   */
  {
    component: "SyncCommitteeContribution",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommitteeContribution" hash="9f9b0125" />`
  },
  /**
   * @SPEC SyncCommitteeMessage
   */
  {
    component: "SyncCommitteeMessage",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommitteeMessage" hash="0764ce67" />`
  },

  // Config Variables
  /**
   * @SPEC BLOB_SCHEDULE
   */
  // {
  //   component: "BLOB_SCHEDULE",
  //   filePath: "packages/params/src/presets/mainnet.ts",
  //   specTag: `<spec config_var="BLOB_SCHEDULE" />`
  // },
  /**
   * @SPEC MAX_PAYLOAD_SIZE
   */
  {
    component: "MAX_PAYLOAD_SIZE",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec config_var="MAX_PAYLOAD_SIZE" hash="7f1566fb" />`
  },
  /**
   * @SPEC PROPOSER_SCORE_BOOST
   */
  {
    component: "PROPOSER_SCORE_BOOST",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec config_var="PROPOSER_SCORE_BOOST" hash="fbc878c6" />`
  },
  /**
   * @SPEC REORG_HEAD_WEIGHT_THRESHOLD
   */
  {
    component: "REORG_HEAD_WEIGHT_THRESHOLD",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec config_var="REORG_HEAD_WEIGHT_THRESHOLD" hash="d4ecaa84" />`
  },
  /**
   * @SPEC REORG_MAX_EPOCHS_SINCE_FINALIZATION
   */
  {
    component: "REORG_MAX_EPOCHS_SINCE_FINALIZATION",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec config_var="REORG_MAX_EPOCHS_SINCE_FINALIZATION" hash="8567706e" />`
  },
  /**
   * @SPEC REORG_PARENT_WEIGHT_THRESHOLD
   */
  {
    component: "REORG_PARENT_WEIGHT_THRESHOLD",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec config_var="REORG_PARENT_WEIGHT_THRESHOLD" hash="cb81e3da" />`
  }
];
