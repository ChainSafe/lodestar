import {CompositeTypeAny, Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, BeaconStateAltair, BeaconStatePhase0} from "../types.js";
import {VALIDATOR_BYTES_SIZE, getForkFromStateBytes, getStateTypeFromBytes} from "./sszBytes.js";

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

// state store inactivity scores of old seed state, we need to update it
// this value rarely changes even after 3 months of data as monitored on mainnet in Sep 2023
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

function findModifiedValidators(
  validatorsBytes: Uint8Array,
  validatorsBytes2: Uint8Array,
  modifiedValidators: number[],
  validatorOffset = 0
): void {
  if (validatorsBytes.length !== validatorsBytes2.length) {
    throw new Error(
      "validatorsBytes.length !== validatorsBytes2.length " + validatorsBytes.length + " vs " + validatorsBytes2.length
    );
  }

  if (Buffer.compare(validatorsBytes, validatorsBytes2) === 0) {
    return;
  }

  if (validatorsBytes.length === VALIDATOR_BYTES_SIZE) {
    modifiedValidators.push(validatorOffset);
    return;
  }

  const numValidator = Math.floor(validatorsBytes.length / VALIDATOR_BYTES_SIZE);
  const halfValidator = Math.floor(numValidator / 2);
  findModifiedValidators(
    validatorsBytes.subarray(0, halfValidator * VALIDATOR_BYTES_SIZE),
    validatorsBytes2.subarray(0, halfValidator * VALIDATOR_BYTES_SIZE),
    modifiedValidators,
    validatorOffset
  );
  findModifiedValidators(
    validatorsBytes.subarray(halfValidator * VALIDATOR_BYTES_SIZE),
    validatorsBytes2.subarray(halfValidator * VALIDATOR_BYTES_SIZE),
    modifiedValidators,
    validatorOffset + halfValidator
  );
}

// as monitored on mainnet, inactivityScores are not changed much and they are mostly 0
function findModifiedInactivityScores(
  inactivityScoresBytes: Uint8Array,
  inactivityScoresBytes2: Uint8Array,
  modifiedValidators: number[],
  validatorOffset = 0
): void {
  if (inactivityScoresBytes.length !== inactivityScoresBytes2.length) {
    throw new Error(
      "inactivityScoresBytes.length !== inactivityScoresBytes2.length " +
        inactivityScoresBytes.length +
        " vs " +
        inactivityScoresBytes2.length
    );
  }

  if (Buffer.compare(inactivityScoresBytes, inactivityScoresBytes2) === 0) {
    return;
  }

  // UintNum64 = 8 bytes
  if (inactivityScoresBytes.length === 8) {
    modifiedValidators.push(validatorOffset);
    return;
  }

  const numValidator = Math.floor(inactivityScoresBytes.length / 8);
  const halfValidator = Math.floor(numValidator / 2);
  findModifiedInactivityScores(
    inactivityScoresBytes.subarray(0, halfValidator * 8),
    inactivityScoresBytes2.subarray(0, halfValidator * 8),
    modifiedValidators,
    validatorOffset
  );
  findModifiedInactivityScores(
    inactivityScoresBytes.subarray(halfValidator * 8),
    inactivityScoresBytes2.subarray(halfValidator * 8),
    modifiedValidators,
    validatorOffset + halfValidator
  );
}
