import {CompositeTypeAny, Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, BeaconStateAltair, BeaconStatePhase0} from "../../types.js";
import {VALIDATOR_BYTES_SIZE, getForkFromStateBytes, getStateTypeFromBytes} from "../sszBytes.js";
import {findModifiedValidators} from "./findModifiedValidators.js";
import {findModifiedInactivityScores} from "./findModifiedInactivityScores.js";

type BeaconStateType =
  | typeof ssz.phase0.BeaconState
  | typeof ssz.altair.BeaconState
  | typeof ssz.bellatrix.BeaconState
  | typeof ssz.capella.BeaconState
  | typeof ssz.deneb.BeaconState;

type MigrateStateOutput = {state: BeaconStateAllForks; modifiedValidators: number[]};

/**
 * Load state from bytes given a seed state so that we share the same base tree. This gives some benefits:
 * - Have single base tree across the application
 * - Faster to load state
 * - Less memory usage
 * - Ultilize the cached HashObjects in seed state due to a lot of validators are not changed, also the inactivity scores.
 * @returns the new state and modified validators
 */
export function loadState(
  config: ChainForkConfig,
  seedState: BeaconStateAllForks,
  stateBytes: Uint8Array
): MigrateStateOutput {
  const stateType = getStateTypeFromBytes(config, stateBytes) as BeaconStateType;
  const dataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
  const fieldRanges = stateType.getFieldRanges(dataView, 0, stateBytes.length);
  const allFields = Object.keys(stateType.fields);
  const validatorsFieldIndex = allFields.indexOf("validators");
  const migratedState = stateType.defaultViewDU();
  // validators is rarely changed
  const validatorsRange = fieldRanges[validatorsFieldIndex];
  const modifiedValidators = loadValidators(
    migratedState,
    seedState,
    stateBytes.subarray(validatorsRange.start, validatorsRange.end)
  );
  // inactivityScores
  // this takes ~500 to hashTreeRoot while this field is rarely changed
  const fork = getForkFromStateBytes(config, stateBytes);
  const seedFork = config.getForkSeq(seedState.slot);

  let loadedInactivityScores = false;
  if (fork >= ForkSeq.altair && seedFork >= ForkSeq.altair) {
    loadedInactivityScores = true;
    const inactivityScoresIndex = allFields.indexOf("inactivityScores");
    const inactivityScoresRange = fieldRanges[inactivityScoresIndex];
    loadInactivityScores(
      migratedState as BeaconStateAltair,
      seedState as BeaconStateAltair,
      stateBytes.subarray(inactivityScoresRange.start, inactivityScoresRange.end)
    );
  }
  for (const [fieldName, typeUnknown] of Object.entries(stateType.fields)) {
    // loaded above
    if (fieldName === "validators" || (loadedInactivityScores && fieldName === "inactivityScores")) {
      continue;
    }
    const field = fieldName as Exclude<keyof BeaconStatePhase0, "type" | "cache" | "node">;
    const type = typeUnknown as Type<unknown>;
    const fieldIndex = allFields.indexOf(field);
    const fieldRange = fieldRanges[fieldIndex];
    if (type.isBasic) {
      (migratedState as BeaconStatePhase0)[field] = type.deserialize(
        stateBytes.subarray(fieldRange.start, fieldRange.end)
      ) as never;
    } else {
      (migratedState as BeaconStatePhase0)[field] = (type as CompositeTypeAny).deserializeToViewDU(
        stateBytes.subarray(fieldRange.start, fieldRange.end)
      ) as never;
    }
  }
  migratedState.commit();

  return {state: migratedState, modifiedValidators};
}

/**
 * This value is rarely changed as monitored 3 month state diffs on mainnet as of Sep 2023.
 * Reusing this data helps save hashTreeRoot time of state ~500ms
 *
 * Given the below tree:
 *
 * seedState.inactivityScores ====>  ROOT
 *                                 /     \
 *                            Hash01       Hash23
 *                           /    \       /    \
 *                       Sco0    Sco1   Sco2   Sco3
 *
 * if score 3 is modified, the new tree looks like this:
 *
 * migratedState.inactivityScores ====> ROOTa
 *                                     /      \
 *                                Hash01      Hash23a
 *                               /    \       /    \
 *                           Sco0    Sco1  Sco2   Sco3a
 */
function loadInactivityScores(
  migratedState: BeaconStateAltair,
  seedState: BeaconStateAltair,
  inactivityScoresBytes: Uint8Array
): void {
  // migratedState starts with the same inactivityScores to seed state
  migratedState.inactivityScores = seedState.inactivityScores.clone();
  const oldValidator = migratedState.inactivityScores.length;
  // UintNum64 = 8 bytes
  const newValidator = inactivityScoresBytes.length / 8;
  const minValidator = Math.min(oldValidator, newValidator);
  const oldInactivityScores = migratedState.inactivityScores.serialize();
  const isMoreValidator = newValidator >= oldValidator;
  const modifiedValidators: number[] = [];
  findModifiedInactivityScores(
    isMoreValidator ? oldInactivityScores : oldInactivityScores.subarray(0, minValidator * 8),
    isMoreValidator ? inactivityScoresBytes.subarray(0, minValidator * 8) : inactivityScoresBytes,
    modifiedValidators
  );

  for (const validatorIndex of modifiedValidators) {
    migratedState.inactivityScores.set(
      validatorIndex,
      ssz.UintNum64.deserialize(inactivityScoresBytes.subarray(validatorIndex * 8, (validatorIndex + 1) * 8))
    );
  }

  if (isMoreValidator) {
    // add new inactivityScores
    for (let validatorIndex = oldValidator; validatorIndex < newValidator; validatorIndex++) {
      migratedState.inactivityScores.push(
        ssz.UintNum64.deserialize(inactivityScoresBytes.subarray(validatorIndex * 8, (validatorIndex + 1) * 8))
      );
    }
  } else {
    if (newValidator - 1 < 0) {
      migratedState.inactivityScores = ssz.altair.InactivityScores.defaultViewDU();
    } else {
      migratedState.inactivityScores = migratedState.inactivityScores.sliceTo(newValidator - 1);
    }
  }
}

/**
 * As of Sep 2021, common validators of 2 mainnet states are rarely changed. However, the benchmark shows that
 * 10k modified validators is not an issue. (see packages/state-transition/test/perf/util/loadState/findModifiedValidators.test.ts)
 *
 * This method loads validators from bytes given a seed state so that they share the same base tree. This gives some benefits:
 *  - Have single base tree across the application
 *  - Faster to load state
 *  - Less memory usage
 *  - Ultilize the cached HashObjects in seed state due to a lot of validators are not changed
 *
 * Given the below tree:
 *
 * seedState.validators ====>  ROOT
 *                            /     \
 *                       Hash01       Hash23
 *                      /    \       /    \
 *                  Val0    Val1   Val2   Val3
 *
 * if validator 3 is modified, the new tree looks like this:
 *
 * migratedState.validators ====>  ROOTa
 *                               /      \
 *                          Hash01      Hash23a
 *                         /    \       /    \
 *                     Val0    Val1   Val2   Val3a
 *
 * @param migratedState state to be migrated, the validators are loaded to this state
 * @returns modified validator indices
 */
function loadValidators(
  migratedState: BeaconStateAllForks,
  seedState: BeaconStateAllForks,
  newValidatorsBytes: Uint8Array
): number[] {
  const seedValidatorCount = seedState.validators.length;
  const newValidatorCount = Math.floor(newValidatorsBytes.length / VALIDATOR_BYTES_SIZE);
  const isMoreValidator = newValidatorCount >= seedValidatorCount;
  const minValidatorCount = Math.min(seedValidatorCount, newValidatorCount);
  // migrated state starts with the same validators to seed state
  migratedState.validators = seedState.validators.clone();
  const seedValidatorsBytes = seedState.validators.serialize();
  const modifiedValidators: number[] = [];
  findModifiedValidators(
    isMoreValidator ? seedValidatorsBytes : seedValidatorsBytes.subarray(0, minValidatorCount * VALIDATOR_BYTES_SIZE),
    isMoreValidator ? newValidatorsBytes.subarray(0, minValidatorCount * VALIDATOR_BYTES_SIZE) : newValidatorsBytes,
    modifiedValidators
  );
  for (const i of modifiedValidators) {
    migratedState.validators.set(
      i,
      ssz.phase0.Validator.deserializeToViewDU(
        newValidatorsBytes.subarray(i * VALIDATOR_BYTES_SIZE, (i + 1) * VALIDATOR_BYTES_SIZE)
      )
    );
  }

  if (newValidatorCount >= seedValidatorCount) {
    // add new validators
    for (let validatorIndex = seedValidatorCount; validatorIndex < newValidatorCount; validatorIndex++) {
      migratedState.validators.push(
        ssz.phase0.Validator.deserializeToViewDU(
          newValidatorsBytes.subarray(
            validatorIndex * VALIDATOR_BYTES_SIZE,
            (validatorIndex + 1) * VALIDATOR_BYTES_SIZE
          )
        )
      );
      modifiedValidators.push(validatorIndex);
    }
  } else {
    migratedState.validators = migratedState.validators.sliceTo(newValidatorCount - 1);
  }
  return modifiedValidators;
}
