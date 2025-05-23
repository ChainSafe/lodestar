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
    {
      component: "SLOTS_PER_EPOCH",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec preset_var="SLOTS_PER_EPOCH" fork="deneb" style="hash" hash="cb41af43" />`
    },
    {
      component: "MAX_VALIDATORS_PER_COMMITTEE",
      filePath: "packages/params/src/presets/mainnet.ts",
      specTag: `<spec preset_var="MAX_VALIDATORS_PER_COMMITTEE" preset="mainnet" fork="deneb" style="hash" hash="900abcb2" />`
    },
    {
      component: "MAX_EFFECTIVE_BALANCE",
      filePath: "packages/params/src/presets/mainnet.ts",
      specTag: `<spec preset_var="MAX_EFFECTIVE_BALANCE" preset="mainnet" fork="deneb" style="hash" hash="13dd1310" />`
    },
  
    // Constants
    {
      component: "GENESIS_SLOT",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec constant_var="GENESIS_SLOT" fork="deneb" style="hash" hash="2d6f8884" />`
    },
    {
      component: "GENESIS_EPOCH",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec constant_var="GENESIS_EPOCH" fork="deneb" style="hash" hash="56876077" />`
    },
    {
      component: "FAR_FUTURE_EPOCH",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec constant_var="FAR_FUTURE_EPOCH" fork="deneb" style="hash" hash="b11f052e" />`
    },
    {
      component: "BASE_REWARDS_PER_EPOCH",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec constant_var="BASE_REWARDS_PER_EPOCH" fork="deneb" style="hash" hash="395f7528" />`
    },
    {
      component: "DEPOSIT_CONTRACT_TREE_DEPTH",
      filePath: "packages/params/src/index.ts",
      specTag: `<spec constant_var="DEPOSIT_CONTRACT_TREE_DEPTH" fork="deneb" style="hash" hash="5763e551" />`
    },
  
    // Functions
    {
      component: "process_epoch",
      filePath: "packages/state-transition/src/epoch/index.ts",
      specTag: `<spec fn="process_epoch" fork="deneb" style="hash" hash="5fb03e76" />`
    },
    {
      component: "process_slashings",
      filePath: "packages/state-transition/src/epoch/processSlashings.ts",
      specTag: `<spec fn="process_slashings" fork="deneb" style="hash" hash="2933bad9" />`
    },
    {
      component: "process_justification_and_finalization",
      filePath: "packages/state-transition/src/epoch/processJustificationAndFinalization.ts",
      specTag: `<spec fn="process_justification_and_finalization" fork="deneb" style="hash" hash="1abbff4b" />`
    },
    {
      component: "process_registry_updates",
      filePath: "packages/state-transition/src/epoch/processRegistryUpdates.ts",
      specTag: `<spec fn="process_registry_updates" fork="deneb" style="hash" hash="ead65fa4" />`
    },
    {
      component: "process_rewards_and_penalties",
      filePath: "packages/state-transition/src/epoch/processRewardsAndPenalties.ts",
      specTag: `<spec fn="process_rewards_and_penalties" fork="deneb" style="hash" hash="66affb5e" />`
    },
  
    // SSZ Objects
    {
      component: "BeaconState",
      filePath: "packages/types/src/altair/sszTypes.ts",
      specTag: `<spec ssz_object="BeaconState" fork="deneb" style="hash" hash="2c98ea31" />`
    },
    {
      component: "BeaconBlock",
      filePath: "packages/types/src/altair/sszTypes.ts",
      specTag: `<spec ssz_object="BeaconBlock" fork="deneb" style="hash" hash="7c6734a7" />`
    },
    {
      component: "Validator",
      filePath: "packages/types/src/phase0/sszTypes.ts",
      specTag: `<spec ssz_object="Validator" fork="deneb" style="hash" hash="9bd7560f" />`
    },
    {
      component: "Attestation",
      filePath: "packages/types/src/phase0/sszTypes.ts",
      specTag: `<spec ssz_object="Attestation" fork="deneb" style="hash" hash="ae248ea9" />`
    },
    
    // Custom Types
    {
      component: "Slot",
      filePath: "packages/types/src/primitive/types.ts",
      specTag: `<spec custom_type="Slot" fork="deneb" style="hash" hash="3e079f92" />`
    },
    {
      component: "Epoch",
      filePath: "packages/types/src/primitive/types.ts",
      specTag: `<spec custom_type="Epoch" fork="deneb" style="hash" hash="df74afa2" />`
    },
    {
      component: "ValidatorIndex",
      filePath: "packages/types/src/primitive/types.ts",
      specTag: `<spec custom_type="ValidatorIndex" fork="deneb" style="hash" hash="a5dd6201" />`
    },
    
    // Additional Functions
    {
      component: "state_transition",
      filePath: "packages/state-transition/src/index.ts",
      specTag: `<spec fn="state_transition" fork="deneb" style="hash" hash="59fed603" />`
    },
    {
      component: "process_block",
      filePath: "packages/state-transition/src/block/index.ts",
      specTag: `<spec fn="process_block" fork="deneb" style="hash" hash="3ad2b9b1" />`
    },
    {
      component: "is_valid_merkle_branch",
      filePath: "packages/state-transition/src/util/merkleTree.ts",
      specTag: `<spec fn="is_valid_merkle_branch" fork="deneb" style="hash" hash="c8299352" />`
    },
    {
      component: "compute_shuffled_index",
      filePath: "packages/state-transition/src/util/shuffle.ts",
      specTag: `<spec fn="compute_shuffled_index" fork="deneb" style="hash" hash="fb87b3d9" />`
    },
    {
      component: "is_active_validator",
      filePath: "packages/state-transition/src/util/validator.ts",
      specTag: `<spec fn="is_active_validator" fork="deneb" style="hash" hash="5147781d" />`
    },
    
    // Electra fork 
    {
      component: "is_fully_withdrawable_validator_electra",
      filePath: "packages/state-transition/src/util/validator.ts",
      specTag: `<spec fn="is_fully_withdrawable_validator" fork="electra" style="hash" hash="f8edb433" />`
    },
    {
      component: "BeaconState_electra",
      filePath: "packages/types/src/altair/sszTypes.ts",
      specTag: `<spec ssz_object="BeaconState" fork="electra" style="hash" hash="e4c02e51" />`
    }
  ];
  