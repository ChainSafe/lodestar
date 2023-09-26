import {ChainConfig, chainConfigToJson} from "@lodestar/config";
import {activePreset, BeaconPreset, presetToJson} from "@lodestar/params";

export class NotEqualParamsError extends Error {}

type ConfigWithPreset = ChainConfig & BeaconPreset;

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Assert localConfig values match externalSpecJson. externalSpecJson may contain more values than localConfig.
 *
 * This check ensures that the validator is connected to a beacon node of the exact same network and params.
 * Otherwise, signatures may be rejected, time may be un-equal and other bugs that are harder to debug caused
 * by different parameters.
 *
 * This check however can't compare the full config as is, since some parameters are not critical to the spec and
 * can be changed un-expectedly. Also, fork parameters can change un-expectedly, like their _FORK_VERSION or _EPOCH.
 * Note that the config API endpoint is not precisely specified, so each clients can return a different set of
 * parameters.
 *
 * So this check only compares a specific list of parameters that are consensus critical, ignoring the rest. Typed
 * config and preset ensure new parameters are labeled critical or ignore, facilitating maintenance of the list.
 */
export function assertEqualParams(localConfig: ChainConfig, externalSpecJson: Record<string, string>): void {
  // Before comparing, add preset which is bundled in api impl config route.
  // config and preset must be serialized to JSON for safe comparisions.
  const localSpecJson = {
    ...chainConfigToJson(localConfig),
    ...presetToJson(activePreset),
  };

  // Get list of keys to check, and keys to ignore. Otherwise this function throws for false positives
  const criticalParams = getSpecCriticalParams(localConfig);

  // Accumulate errors first and print all of them at once
  const errors: string[] = [];

  for (const key of Object.keys(criticalParams) as (keyof typeof criticalParams)[]) {
    if (
      // Ignore non-critical params
      !criticalParams[key] ||
      // This condition should never be true, but just in case
      localSpecJson[key] === undefined ||
      // The config/spec endpoint is poorly specified, so in practice each client returns a custom selection of keys.
      // For example Lighthouse returns a manually selected list of keys that may be updated at any time.
      // https://github.com/sigp/lighthouse/blob/bac7c3fa544495a257722aaad9cd8f72fee2f2b4/consensus/types/src/chain_spec.rs#L941
      //
      // So if we assert that spec critical keys are present in the spec we may break interoperability unexpectedly.
      // So it's best to ignore keys are not defined in both specs and trust that the ones defined are sufficient
      // to detect spec discrepancies in all cases.
      externalSpecJson[key] === undefined
    ) {
      continue;
    }

    // Must compare JSON serialized specs, to ensure all strings are rendered in the same way
    // Must compare as lowercase to ensure checksum addresses and names have same capilatization
    const localValue = String(localSpecJson[key]).toLocaleLowerCase();
    const remoteValue = String(externalSpecJson[key]).toLocaleLowerCase();
    if (localValue !== remoteValue) {
      errors.push(`${key} different value: ${localValue} != ${remoteValue}`);
    }
  }

  if (errors.length > 0) {
    throw new NotEqualParamsError("Local and remote configs are different\n" + errors.join("\n"));
  }
}

function getSpecCriticalParams(localConfig: ChainConfig): Record<keyof ConfigWithPreset, boolean> {
  const altairForkRelevant = localConfig.ALTAIR_FORK_EPOCH < Infinity;
  const bellatrixForkRelevant = localConfig.BELLATRIX_FORK_EPOCH < Infinity;
  const capellaForkRelevant = localConfig.CAPELLA_FORK_EPOCH < Infinity;
  const denebForkRelevant = localConfig.DENEB_FORK_EPOCH < Infinity;

  return {
    // # Config
    ///////////

    PRESET_BASE: false, // Not relevant, each preset value is checked below
    CONFIG_NAME: false, // Arbitrary string, not relevant
    // validator client behaviour does not change with this parameters, so it's not concerned about them.
    // However, with the override ttd flag, the validator and beacon could be out of sync and prevent it from running.
    TERMINAL_TOTAL_DIFFICULTY: false,
    TERMINAL_BLOCK_HASH: false,
    TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH: false,

    // Genesis
    MIN_GENESIS_ACTIVE_VALIDATOR_COUNT: true,
    MIN_GENESIS_TIME: true,
    GENESIS_FORK_VERSION: true,
    GENESIS_DELAY: true,

    // Forking
    // Altair
    ALTAIR_FORK_VERSION: altairForkRelevant,
    ALTAIR_FORK_EPOCH: altairForkRelevant,
    // Bellatrix
    BELLATRIX_FORK_VERSION: bellatrixForkRelevant,
    BELLATRIX_FORK_EPOCH: bellatrixForkRelevant,
    // Capella
    CAPELLA_FORK_VERSION: capellaForkRelevant,
    CAPELLA_FORK_EPOCH: capellaForkRelevant,
    // Deneb
    DENEB_FORK_VERSION: denebForkRelevant,
    DENEB_FORK_EPOCH: denebForkRelevant,

    // Time parameters
    SECONDS_PER_SLOT: true,
    SECONDS_PER_ETH1_BLOCK: true,
    MIN_VALIDATOR_WITHDRAWABILITY_DELAY: true,
    SHARD_COMMITTEE_PERIOD: true,
    ETH1_FOLLOW_DISTANCE: true,

    // Validator cycle
    INACTIVITY_SCORE_BIAS: true,
    INACTIVITY_SCORE_RECOVERY_RATE: true,
    EJECTION_BALANCE: true,
    MIN_PER_EPOCH_CHURN_LIMIT: true,
    MAX_PER_EPOCH_CHURN_LIMIT: denebForkRelevant,
    CHURN_LIMIT_QUOTIENT: true,

    // Proposer boost
    PROPOSER_SCORE_BOOST: false, // Ignored as it's changing https://github.com/ethereum/consensus-specs/pull/2895

    // Deposit contract
    DEPOSIT_CHAIN_ID: false, // Non-critical
    DEPOSIT_NETWORK_ID: false, // Non-critical
    DEPOSIT_CONTRACT_ADDRESS: true,

    // # Phase0Preset
    /////////////////

    MAX_COMMITTEES_PER_SLOT: true,
    TARGET_COMMITTEE_SIZE: true,
    MAX_VALIDATORS_PER_COMMITTEE: true,

    SHUFFLE_ROUND_COUNT: true,

    HYSTERESIS_QUOTIENT: true,
    HYSTERESIS_DOWNWARD_MULTIPLIER: true,
    HYSTERESIS_UPWARD_MULTIPLIER: true,

    // Gwei Values
    MIN_DEPOSIT_AMOUNT: true,
    MAX_EFFECTIVE_BALANCE: true,
    EFFECTIVE_BALANCE_INCREMENT: true,

    // Time parameters
    MIN_ATTESTATION_INCLUSION_DELAY: true,
    SLOTS_PER_EPOCH: true,
    MIN_SEED_LOOKAHEAD: true,
    MAX_SEED_LOOKAHEAD: true,
    EPOCHS_PER_ETH1_VOTING_PERIOD: true,
    SLOTS_PER_HISTORICAL_ROOT: true,
    MIN_EPOCHS_TO_INACTIVITY_PENALTY: true,

    // State vector lengths
    EPOCHS_PER_HISTORICAL_VECTOR: true,
    EPOCHS_PER_SLASHINGS_VECTOR: true,
    HISTORICAL_ROOTS_LIMIT: true,
    VALIDATOR_REGISTRY_LIMIT: true,

    // Reward and penalty quotients
    BASE_REWARD_FACTOR: true,
    WHISTLEBLOWER_REWARD_QUOTIENT: true,
    PROPOSER_REWARD_QUOTIENT: true,
    INACTIVITY_PENALTY_QUOTIENT: true,
    MIN_SLASHING_PENALTY_QUOTIENT: true,
    PROPORTIONAL_SLASHING_MULTIPLIER: true,

    // Max operations per block
    MAX_PROPOSER_SLASHINGS: true,
    MAX_ATTESTER_SLASHINGS: true,
    MAX_ATTESTATIONS: true,
    MAX_DEPOSITS: true,
    MAX_VOLUNTARY_EXITS: true,

    // # AltairPreset
    /////////////////

    SYNC_COMMITTEE_SIZE: altairForkRelevant,
    EPOCHS_PER_SYNC_COMMITTEE_PERIOD: altairForkRelevant,
    INACTIVITY_PENALTY_QUOTIENT_ALTAIR: altairForkRelevant,
    MIN_SLASHING_PENALTY_QUOTIENT_ALTAIR: altairForkRelevant,
    PROPORTIONAL_SLASHING_MULTIPLIER_ALTAIR: altairForkRelevant,
    MIN_SYNC_COMMITTEE_PARTICIPANTS: false, // Only relevant for lightclients
    UPDATE_TIMEOUT: false, // Only relevant for lightclients

    // # BellatrixPreset
    /////////////////

    INACTIVITY_PENALTY_QUOTIENT_BELLATRIX: bellatrixForkRelevant,
    MIN_SLASHING_PENALTY_QUOTIENT_BELLATRIX: bellatrixForkRelevant,
    PROPORTIONAL_SLASHING_MULTIPLIER_BELLATRIX: bellatrixForkRelevant,
    MAX_BYTES_PER_TRANSACTION: bellatrixForkRelevant,
    MAX_TRANSACTIONS_PER_PAYLOAD: bellatrixForkRelevant,
    BYTES_PER_LOGS_BLOOM: bellatrixForkRelevant,
    MAX_EXTRA_DATA_BYTES: bellatrixForkRelevant,

    // # CapellaPreset
    /////////////////
    MAX_BLS_TO_EXECUTION_CHANGES: capellaForkRelevant,
    MAX_WITHDRAWALS_PER_PAYLOAD: capellaForkRelevant,
    MAX_VALIDATORS_PER_WITHDRAWALS_SWEEP: capellaForkRelevant,

    // # DenebPreset
    /////////////////
    FIELD_ELEMENTS_PER_BLOB: denebForkRelevant,
    MAX_BLOBS_PER_BLOCK: denebForkRelevant,
    MAX_BLOB_COMMITMENTS_PER_BLOCK: denebForkRelevant,
  };
}
