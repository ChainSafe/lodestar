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
   * @spec compute_fork_digest
   */
  {
    component: "compute_fork_digest",
    filePath: "packages/config/src/genesisConfig/index.ts",
    specTag: `<spec fn="compute_fork_digest" hash="8b33f64d" />`,
  },
  /**
   * @spec compute_fork_version
   */
  {
    component: "compute_fork_version",
    filePath: "packages/state-transition/src/util/domain.ts",
    specTag: `<spec fn="compute_fork_version" hash="6d472038" />`,
  },
  /**
   * @spec compute_proposer_index
   */
  {
    component: "compute_proposer_index",
    filePath: "packages/state-transition/src/util/seed.ts",
    specTag: `<spec fn="compute_proposer_index" hash="74c8109d" />`,
  },
  /**
   * @spec get_attesting_indices
   */
  {
    component: "get_attesting_indices",
    filePath: "packages/state-transition/src/cache/epochCache.ts",
    specTag: `<spec fn="get_attesting_indices" hash="3304d67e" />`,
  },
  /**
   * @spec get_beacon_committee
   */
  {
    component: "get_beacon_committee",
    filePath: "packages/state-transition/src/cache/epochCache.ts",
    specTag: `<spec fn="get_beacon_committee" hash="f04db100" />`,
  },
  /**
   * @spec MAX_BLOBS_PER_BLOCK
   */
  {
    component: "MAX_BLOBS_PER_BLOCK",
    filePath: "packages/config/src/forkConfig/index.ts",
    specTag: `<spec config_var="MAX_BLOBS_PER_BLOCK" hash="3521ad35" />`,
  },
  /**
   * @spec get_max_effective_balance
   */
  {
    component: "get_max_effective_balance",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="get_max_effective_balance" hash="77f96872" />`,
  },
  /**
   * @spec prepare_execution_payload
   */
  {
    component: "prepare_execution_payload",
    filePath: "packages/beacon-node/src/chain/produceBlock/produceBlockBody.ts",
    specTag: `<spec fn="prepare_execution_payload" hash="ea67dc0d" />`,
  },
  /**
   * @spec process_attestation
   */
  {
    component: "process_attestation",
    filePath: "packages/state-transition/src/block/processAttestations.ts",
    specTag: `<spec fn="process_attestation" hash="ac9b7566" />`,
  },
  /**
   * @spec process_attester_slashing
   */
  {
    component: "process_attester_slashing",
    filePath: "packages/state-transition/src/block/processAttesterSlashing.ts",
    specTag: `<spec fn="process_attester_slashing" hash="52b53198" />`,
  },
  /**
   * @spec process_block
   */
  {
    component: "process_block",
    filePath: "packages/state-transition/src/block/index.ts",
    specTag: `<spec fn="process_block" hash="a30c9ad3" />`,
  },
  /**
   * @spec process_block_header
   */
  {
    component: "process_block_header",
    filePath: "packages/state-transition/src/block/processBlockHeader.ts",
    specTag: `<spec fn="process_block_header" hash="53fd0b1a" />`,
  },
  /**
   * @spec process_consolidation_request
   */
  {
    component: "process_consolidation_request",
    filePath: "packages/state-transition/src/block/processConsolidationRequest.ts",
    specTag: `<spec fn="process_consolidation_request" hash="d1802f07" />`,
  },
  /**
   * @spec process_deposit
   */
  {
    component: "process_deposit",
    filePath: "packages/state-transition/src/block/processDeposit.ts",
    specTag: `<spec fn="process_deposit" hash="a74bd5ef" />`,
  },
  /**
   * @spec process_deposit_request
   */
  {
    component: "process_deposit_request",
    filePath: "packages/state-transition/src/block/processDepositRequest.ts",
    specTag: `<spec fn="process_deposit_request" hash="5f0a91a2" />`,
  },
  /**
   * @spec process_effective_balance_updates
   */
  {
    component: "process_effective_balance_updates",
    filePath: "packages/state-transition/src/epoch/processEffectiveBalanceUpdates.ts",
    specTag: `<spec fn="process_effective_balance_updates" hash="ab5e4c4c" />`,
  },
  /**
   * @spec process_epoch
   */
  {
    component: "process_epoch",
    filePath: "packages/state-transition/src/epoch/index.ts",
    specTag: `<spec fn="process_epoch" hash="771a9cad" />`,
  },
  /**
   * @spec process_execution_payload
   */
  {
    component: "process_execution_payload",
    filePath: "packages/state-transition/src/block/processExecutionPayload.ts",
    specTag: `<spec fn="process_execution_payload" hash="695ef30e" />`,
  },
  /**
   * @spec process_justification_and_finalization
   */
  {
    component: "process_justification_and_finalization",
    filePath: "packages/state-transition/src/epoch/processJustificationAndFinalization.ts",
    specTag: `<spec fn="process_justification_and_finalization" hash="4d8d34d0" />`,
  },
  /**
   * @spec process_light_client_finality_update
   */
  {
    component: "process_light_client_finality_update",
    filePath: "packages/light-client/src/spec/processLightClientUpdate.ts",
    specTag: `<spec fn="process_light_client_finality_update" hash="387eeb1d" />`,
  },
  /**
   * @spec process_light_client_optimistic_update
   */
  {
    component: "process_light_client_optimistic_update",
    filePath: "packages/light-client/src/spec/index.ts",
    specTag: `<spec fn="process_light_client_optimistic_update" hash="088e97c1" />`,
  },
  /**
   * @spec process_light_client_store_force_update
   */
  {
    component: "process_light_client_store_force_update",
    filePath: "packages/light-client/src/spec/index.ts",
    specTag: `<spec fn="process_light_client_store_force_update" hash="2e537c22" />`,
  },
  /**
   * @spec process_light_client_update
   */
  {
    component: "process_light_client_update",
    filePath: "packages/light-client/src/spec/processLightClientUpdate.ts",
    specTag: `<spec fn="process_light_client_update" hash="0e9d049d" />`,
  },
  /**
   * @spec process_operations
   */
  {
    component: "process_operations",
    filePath: "packages/state-transition/src/block/processOperations.ts",
    specTag: `<spec fn="process_operations" hash="fae5e580" />`,
  },
  /**
   * @spec process_pending_consolidations
   */
  {
    component: "process_pending_consolidations",
    filePath: "packages/state-transition/src/epoch/processPendingConsolidations.ts",
    specTag: `<spec fn="process_pending_consolidations" hash="1d328e17" />`,
  },
  /**
   * @spec process_pending_deposits
   */
  {
    component: "process_pending_deposits",
    filePath: "packages/state-transition/src/epoch/processPendingDeposits.ts",
    specTag: `<spec fn="process_pending_deposits" hash="773298bd" />`,
  },
  /**
   * @spec process_proposer_slashing
   */
  {
    component: "process_proposer_slashing",
    filePath: "packages/state-transition/src/block/processProposerSlashing.ts",
    specTag: `<spec fn="process_proposer_slashing" hash="0f11acaf" />`,
  },
  /**
   * @spec process_randao
   */
  {
    component: "process_randao",
    filePath: "packages/state-transition/src/block/processRandao.ts",
    specTag: `<spec fn="process_randao" hash="0109972b" />`,
  },
  /**
   * @spec process_registry_updates
   */
  {
    component: "process_registry_updates",
    filePath: "packages/state-transition/src/epoch/processRegistryUpdates.ts",
    specTag: `<spec fn="process_registry_updates" hash="00c97a64" />`,
  },
  /**
   * @spec process_rewards_and_penalties
   */
  {
    component: "process_rewards_and_penalties",
    filePath: "packages/state-transition/src/epoch/processRewardsAndPenalties.ts",
    specTag: `<spec fn="process_rewards_and_penalties" hash="1e870ebc" />`,
  },
  /**
   * @spec process_slashings
   */
  {
    component: "process_slashings",
    filePath: "packages/state-transition/src/epoch/processSlashings.ts",
    specTag: `<spec fn="process_slashings" hash="ec8aa896" />`,
  },
  /**
   * @spec process_slot
   */
  {
    component: "process_slot",
    filePath: "packages/state-transition/src/slot/index.ts",
    specTag: `<spec fn="process_slot" hash="fd0bdca5" />`,
  },
  /**
   * @spec process_sync_aggregate
   */
  {
    component: "process_sync_aggregate",
    filePath: "packages/state-transition/src/block/processSyncAggregate.ts",
    specTag: `<spec fn="process_sync_aggregate" hash="f31b8b9c" />`,
  },
  /**
   * @spec process_sync_committee_contributions
   */
  {
    component: "process_sync_committee_contributions",
    filePath: "packages/state-transition/src/block/processSyncCommittee.ts",
    specTag: `<spec fn="process_sync_committee_contributions" hash="cc848e7c" />`,
  },
  /**
   * @spec process_sync_committee_updates
   */
  {
    component: "process_sync_committee_updates",
    filePath: "packages/state-transition/src/epoch/processSyncCommitteeUpdates.ts",
    specTag: `<spec fn="process_sync_committee_updates" hash="9e59de37" />`,
  },
  /**
   * @spec process_voluntary_exit
   */
  {
    component: "process_voluntary_exit",
    filePath: "packages/state-transition/src/block/processVoluntaryExit.ts",
    specTag: `<spec fn="process_voluntary_exit" hash="3ee83868" />`,
  },
  /**
   * @spec process_withdrawal_request
   */
  {
    component: "process_withdrawal_request",
    filePath: "packages/state-transition/src/block/processWithdrawalRequest.ts",
    specTag: `<spec fn="process_withdrawal_request" hash="76c75ae8" />`,
  },
  /**
   * @spec process_withdrawals
   */
  {
    component: "process_withdrawals",
    filePath: "packages/state-transition/src/block/processWithdrawals.ts",
    specTag: `<spec fn="process_withdrawals" hash="3527c68c" />`,
  },
  /**
   * @spec state_transition
   */
  {
    component: "state_transition",
    filePath: "packages/state-transition/src/stateTransition.ts",
    specTag: `<spec fn="state_transition" hash="356909b9" />`,
  },

  // SSZ Objects
  /**
   * @spec AggregateAndProof
   */
  {
    component: "AggregateAndProof",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="AggregateAndProof" hash="a218764f" />`,
  },
  /**
   * @spec Attestation
   */
  {
    component: "Attestation",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="Attestation" hash="a1de4d5b" />`,
  },
  /**
   * @spec BeaconBlock
   */
  {
    component: "BeaconBlock",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlock" hash="79909f0a" />`,
  },
  /**
   * @spec BeaconBlockBody
   */
  {
    component: "BeaconBlockBody",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlockBody" hash="7c054a64" />`,
  },
  /**
   * @spec BeaconBlockHeader
   */
  {
    component: "BeaconBlockHeader",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlockHeader" hash="0be4f2e7" />`,
  },
  /**
   * @spec BeaconState
   */
  {
    component: "BeaconState",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" hash="910d0f39" />`,
  },
  /**
   * @spec ExecutionPayload
   */
  {
    component: "ExecutionPayload",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionPayload" hash="3c96a4a7" />`,
  },
  /**
   * @spec ExecutionPayloadHeader
   */
  {
    component: "ExecutionPayloadHeader",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionPayloadHeader" hash="438d9b8b" />`,
  },
  /**
   * @spec ExecutionRequests
   */
  {
    component: "ExecutionRequests",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="ExecutionRequests" hash="5b530db0" />`,
  },
  /**
   * @spec LightClientBootstrap
   */
  {
    component: "LightClientBootstrap",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientBootstrap" hash="1e7a218b" />`,
  },
  /**
   * @spec LightClientFinalityUpdate
   */
  {
    component: "LightClientFinalityUpdate",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientFinalityUpdate" hash="85006d6b" />`,
  },
  /**
   * @spec LightClientHeader
   */
  {
    component: "LightClientHeader",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientHeader" hash="a99c9471" />`,
  },
  /**
   * @spec LightClientOptimisticUpdate
   */
  {
    component: "LightClientOptimisticUpdate",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientOptimisticUpdate" hash="c5493784" />`,
  },
  /**
   * @spec LightClientUpdate
   */
  {
    component: "LightClientUpdate",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="LightClientUpdate" hash="9c59b062" />`,
  },
  /**
   * @spec SingleAttestation
   */
  {
    component: "SingleAttestation",
    filePath: "packages/types/src/electra/sszTypes.ts",
    specTag: `<spec ssz_object="SingleAttestation" hash="f67f746a" />`,
  },
  /**
   * @spec SyncAggregate
   */
  {
    component: "SyncAggregate",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncAggregate" hash="51e247e5" />`,
  },
  /**
   * @spec SyncAggregatorSelectionData
   */
  {
    component: "SyncAggregatorSelectionData",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncAggregatorSelectionData" hash="990a8a7f" />`,
  },
  /**
   * @spec SyncCommittee
   */
  {
    component: "SyncCommittee",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommittee" hash="b1d52376" />`,
  },
  /**
   * @spec SyncCommitteeContribution
   */
  {
    component: "SyncCommitteeContribution",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommitteeContribution" hash="9f9b0125" />`,
  },
  /**
   * @spec SyncCommitteeMessage
   */
  {
    component: "SyncCommitteeMessage",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="SyncCommitteeMessage" hash="0764ce67" />`,
  },

  // Config Variables
  /**
   * @spec PROPOSER_SCORE_BOOST
   */
  {
    component: "PROPOSER_SCORE_BOOST",
    filePath: "packages/config/src/chainConfig/configs/mainnet.ts",
    specTag: `<spec config_var="PROPOSER_SCORE_BOOST" hash="fbc878c6" />`,
  },
  /**
   * @spec REORG_HEAD_WEIGHT_THRESHOLD
   */
  {
    component: "REORG_HEAD_WEIGHT_THRESHOLD",
    filePath: "packages/config/src/chainConfig/configs/mainnet.ts",
    specTag: `<spec config_var="REORG_HEAD_WEIGHT_THRESHOLD" hash="d4ecaa84" />`,
  },
  /**
   * @spec REORG_MAX_EPOCHS_SINCE_FINALIZATION
   */
  {
    component: "REORG_MAX_EPOCHS_SINCE_FINALIZATION",
    filePath: "packages/config/src/chainConfig/configs/mainnet.ts",
    specTag: `<spec config_var="REORG_MAX_EPOCHS_SINCE_FINALIZATION" hash="8567706e" />`,
  },
  /**
   * @spec REORG_PARENT_WEIGHT_THRESHOLD
   */
  {
    component: "REORG_PARENT_WEIGHT_THRESHOLD",
    filePath: "packages/config/src/chainConfig/configs/mainnet.ts",
    specTag: `<spec config_var="REORG_PARENT_WEIGHT_THRESHOLD" hash="cb81e3da" />`,
  },
];
