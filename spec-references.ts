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
  // Preset Variables
  /**
   * @SPEC SLOTS_PER_EPOCH
   */
  {
    component: "SLOTS_PER_EPOCH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec preset_var="SLOTS_PER_EPOCH" fork="deneb" style="hash" hash="cb41af43" />`
  },
  /**
   * @SPEC MAX_VALIDATORS_PER_COMMITTEE
   */
  {
    component: "MAX_VALIDATORS_PER_COMMITTEE",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec preset_var="MAX_VALIDATORS_PER_COMMITTEE" preset="mainnet" fork="deneb" style="hash" hash="900abcb2" />`
  },
  /**
   * @SPEC MAX_EFFECTIVE_BALANCE
   */
  {
    component: "MAX_EFFECTIVE_BALANCE",
    filePath: "packages/params/src/presets/mainnet.ts",
    specTag: `<spec preset_var="MAX_EFFECTIVE_BALANCE" preset="mainnet" fork="deneb" style="hash" hash="13dd1310" />`
  },

  // Constants
  /**
   * @SPEC GENESIS_SLOT
   */
  {
    component: "GENESIS_SLOT",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="GENESIS_SLOT" fork="deneb" style="hash" hash="2d6f8884" />`
  },
  /**
   * @SPEC GENESIS_EPOCH
   */
  {
    component: "GENESIS_EPOCH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="GENESIS_EPOCH" fork="deneb" style="hash" hash="56876077" />`
  },
  /**
   * @SPEC FAR_FUTURE_EPOCH
   */
  {
    component: "FAR_FUTURE_EPOCH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="FAR_FUTURE_EPOCH" fork="deneb" style="hash" hash="b11f052e" />`
  },
  /**
   * @SPEC BASE_REWARDS_PER_EPOCH
   */
  {
    component: "BASE_REWARDS_PER_EPOCH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="BASE_REWARDS_PER_EPOCH" fork="deneb" style="hash" hash="395f7528" />`
  },
  /**
   * @SPEC DEPOSIT_CONTRACT_TREE_DEPTH
   */
  {
    component: "DEPOSIT_CONTRACT_TREE_DEPTH",
    filePath: "packages/params/src/index.ts",
    specTag: `<spec constant_var="DEPOSIT_CONTRACT_TREE_DEPTH" fork="deneb" style="hash" hash="5763e551" />`
  },

  // Functions
  /**
   * @SPEC process_epoch
   */
  {
    component: "process_epoch",
    filePath: "packages/state-transition/src/epoch/index.ts",
    specTag: `<spec fn="process_epoch" fork="deneb" style="hash" hash="5fb03e76" />`
  },
  /**
   * @SPEC process_slashings
   */
  {
    component: "process_slashings",
    filePath: "packages/state-transition/src/epoch/processSlashings.ts",
    specTag: `<spec fn="process_slashings" fork="deneb" style="hash" hash="2933bad9" />`
  },
  /**
   * @SPEC process_justification_and_finalization
   */
  {
    component: "process_justification_and_finalization",
    filePath: "packages/state-transition/src/epoch/processJustificationAndFinalization.ts",
    specTag: `<spec fn="process_justification_and_finalization" fork="deneb" style="hash" hash="1abbff4b" />`
  },
  /**
   * @SPEC process_registry_updates
   */
  {
    component: "process_registry_updates",
    filePath: "packages/state-transition/src/epoch/processRegistryUpdates.ts",
    specTag: `<spec fn="process_registry_updates" fork="deneb" style="hash" hash="ead65fa4" />`
  },
  /**
   * @SPEC process_rewards_and_penalties
   */
  {
    component: "process_rewards_and_penalties",
    filePath: "packages/state-transition/src/epoch/processRewardsAndPenalties.ts",
    specTag: `<spec fn="process_rewards_and_penalties" fork="deneb" style="hash" hash="66affb5e" />`
  },

  // SSZ Objects
  /**
   * @SPEC BeaconState
   */
  {
    component: "BeaconState",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" fork="deneb" style="hash" hash="5ac934a7" />`
  },
  /**
   * @SPEC BeaconBlock
   */
  {
    component: "BeaconBlock",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconBlock" fork="deneb" style="hash" hash="79909f0a" />`
  },
  /**
   * @SPEC Validator
   */
  {
    component: "Validator",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="Validator" fork="deneb" style="hash" hash="682deaf5" />`
  },
  /**
   * @SPEC Attestation
   */
  {
    component: "Attestation",
    filePath: "packages/types/src/phase0/sszTypes.ts",
    specTag: `<spec ssz_object="Attestation" fork="deneb" style="hash" hash="5fc71dce" />`
  },
  
  // Custom Types
  /**
   * @SPEC Slot
   */
  {
    component: "Slot",
    filePath: "packages/types/src/primitive/types.ts",
    specTag: `<spec custom_type="Slot" fork="deneb" style="hash" hash="d0056c55" />`
  },
  /**
   * @SPEC Epoch
   */
  {
    component: "Epoch",
    filePath: "packages/types/src/primitive/types.ts",
    specTag: `<spec custom_type="Epoch" fork="deneb" style="hash" hash="f4ad4edb" />`
  },
  /**
   * @SPEC ValidatorIndex
   */
  {
    component: "ValidatorIndex",
    filePath: "packages/types/src/primitive/types.ts",
    specTag: `<spec custom_type="ValidatorIndex" fork="deneb" style="hash" hash="3bab44f1" />`
  },
  
  // Additional Functions
  /**
   * @SPEC state_transition
   */
  {
    component: "state_transition",
    filePath: "packages/state-transition/src/index.ts",
    specTag: `<spec fn="state_transition" fork="deneb" style="hash" hash="7ff5b160" />`
  },
  /**
   * @SPEC process_block
   */
  {
    component: "process_block",
    filePath: "packages/state-transition/src/block/index.ts",
    specTag: `<spec fn="process_block" fork="deneb" style="hash" hash="48f1bad4" />`
  },
  /**
   * @SPEC is_valid_merkle_branch
   */
  {
    component: "is_valid_merkle_branch",
    filePath: "packages/state-transition/src/util/merkleTree.ts",
    specTag: `<spec fn="is_valid_merkle_branch" fork="deneb" style="hash" hash="f4534863" />`
  },
  /**
   * @SPEC compute_shuffled_index
   */
  {
    component: "compute_shuffled_index",
    filePath: "packages/state-transition/src/util/shuffle.ts",
    specTag: `<spec fn="compute_shuffled_index" fork="deneb" style="hash" hash="cc6d39c6" />`
  },
  /**
   * @SPEC is_active_validator
   */
  {
    component: "is_active_validator",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="is_active_validator" fork="deneb" style="hash" hash="f8673b09" />`
  },
  
  // Electra fork 
  /**
   * @SPEC is_fully_withdrawable_validator_electra
   */
  {
    component: "is_fully_withdrawable_validator_electra",
    filePath: "packages/state-transition/src/util/validator.ts",
    specTag: `<spec fn="is_fully_withdrawable_validator" fork="electra" style="hash" hash="db768b76" />`
  },
  /**
   * @SPEC BeaconState_electra
   */
  {
    component: "BeaconState_electra",
    filePath: "packages/types/src/altair/sszTypes.ts",
    specTag: `<spec ssz_object="BeaconState" fork="electra" style="hash" hash="5880be29" />`
  }
];
