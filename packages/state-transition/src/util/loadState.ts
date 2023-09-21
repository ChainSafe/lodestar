import {CompositeTypeAny, Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ForkSeq} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks, BeaconStateAltair, BeaconStatePhase0} from "../types.js";
import {VALIDATOR_BYTES_SIZE, getForkFromStateBytes, getStateSlotFromBytes, getStateTypeFromBytes} from "./sszBytes.js";

type BeaconStateType =
  | typeof ssz.phase0.BeaconState
  | typeof ssz.altair.BeaconState
  | typeof ssz.bellatrix.BeaconState
  | typeof ssz.capella.BeaconState
  | typeof ssz.deneb.BeaconState;

type BytesRange = {start: number; end: number};
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
  const seedStateType = config.getForkTypes(seedState.slot).BeaconState as BeaconStateType;
  const stateType = getStateTypeFromBytes(config, stateBytes) as BeaconStateType;
  if (stateType !== seedStateType) {
    // TODO: how can we reload state with different type?
    throw new Error(
      `Cannot migrate state of different forks, seedSlot=${seedState.slot}, newSlot=${getStateSlotFromBytes(
        stateBytes
      )}`
    );
  }
  const dataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
  const fieldRanges = stateType.getFieldRanges(dataView, 0, stateBytes.length);
  const allFields = Object.keys(stateType.fields);
  const validatorsFieldIndex = allFields.indexOf("validators");
  const modifiedValidators: number[] = [];
  const clonedState = loadValidators(seedState, fieldRanges, validatorsFieldIndex, stateBytes, modifiedValidators);
  // genesisTime, could skip
  // genesisValidatorsRoot, could skip
  // validators is loaded above
  // inactivityScores
  // this takes ~500 to hashTreeRoot, should we only update individual field?
  const fork = getForkFromStateBytes(config, stateBytes);
  if (fork >= ForkSeq.altair) {
    const inactivityScoresIndex = allFields.indexOf("inactivityScores");
    const inactivityScoresRange = fieldRanges[inactivityScoresIndex];
    loadInactivityScores(
      clonedState as BeaconStateAltair,
      stateBytes.subarray(inactivityScoresRange.start, inactivityScoresRange.end)
    );
  }
  for (const [fieldName, typeUnknown] of Object.entries(stateType.fields)) {
    if (
      // same to all states
      fieldName === "genesisTime" ||
      fieldName === "genesisValidatorsRoot" ||
      // loaded above
      fieldName === "validators" ||
      fieldName === "inactivityScores"
    ) {
      continue;
    }
    const field = fieldName as Exclude<keyof BeaconStatePhase0, "type" | "cache" | "node">;
    const type = typeUnknown as Type<unknown>;
    const fieldIndex = allFields.indexOf(field);
    const fieldRange = fieldRanges[fieldIndex];
    if (type.isBasic) {
      (clonedState as BeaconStatePhase0)[field] = type.deserialize(
        stateBytes.subarray(fieldRange.start, fieldRange.end)
      ) as never;
    } else {
      (clonedState as BeaconStatePhase0)[field] = (type as CompositeTypeAny).deserializeToViewDU(
        stateBytes.subarray(fieldRange.start, fieldRange.end)
      ) as never;
    }
  }
  clonedState.commit();

  return {state: clonedState, modifiedValidators};
}

// state store inactivity scores of old seed state, we need to update it
// this value rarely changes even after 3 months of data as monitored on mainnet in Sep 2023
function loadInactivityScores(state: BeaconStateAltair, inactivityScoresBytes: Uint8Array): void {
  const oldValidator = state.inactivityScores.length;
  // UintNum64 = 8 bytes
  const newValidator = inactivityScoresBytes.length / 8;
  const minValidator = Math.min(oldValidator, newValidator);
  const oldInactivityScores = state.inactivityScores.serialize();
  const isMoreValidator = newValidator >= oldValidator;
  const modifiedValidators: number[] = [];
  findModifiedInactivityScores(
    isMoreValidator ? oldInactivityScores : oldInactivityScores.subarray(0, minValidator * 8),
    isMoreValidator ? inactivityScoresBytes.subarray(0, minValidator * 8) : inactivityScoresBytes,
    modifiedValidators
  );

  for (const validatorIndex of modifiedValidators) {
    state.inactivityScores.set(
      validatorIndex,
      ssz.UintNum64.deserialize(inactivityScoresBytes.subarray(validatorIndex * 8, (validatorIndex + 1) * 8))
    );
  }

  if (isMoreValidator) {
    // add new inactivityScores
    for (let validatorIndex = oldValidator; validatorIndex < newValidator; validatorIndex++) {
      state.inactivityScores.push(
        ssz.UintNum64.deserialize(inactivityScoresBytes.subarray(validatorIndex * 8, (validatorIndex + 1) * 8))
      );
    }
  } else {
    // TODO: next version of ssz https://github.com/ChainSafe/ssz/pull/336
    // or implement a tmp type in lodestar with sliceTo
    // state.inactivityScores = state.inactivityScores.sliceTo(newValidator - 1);
  }
}

function loadValidators(
  seedState: BeaconStateAllForks,
  fieldRanges: BytesRange[],
  validatorsFieldIndex: number,
  data: Uint8Array,
  modifiedValidators: number[] = []
): BeaconStateAllForks {
  const validatorsRange = fieldRanges[validatorsFieldIndex];
  const oldValidatorCount = seedState.validators.length;
  const newValidatorCount = (validatorsRange.end - validatorsRange.start) / VALIDATOR_BYTES_SIZE;
  const isMoreValidator = newValidatorCount >= oldValidatorCount;
  const minValidatorCount = Math.min(oldValidatorCount, newValidatorCount);
  // new state now have same validators to seed state
  const newState = seedState.clone();
  const validatorsBytes = seedState.validators.serialize();
  const validatorsBytes2 = data.slice(validatorsRange.start, validatorsRange.end);
  findModifiedValidators(
    isMoreValidator ? validatorsBytes : validatorsBytes.subarray(0, minValidatorCount * VALIDATOR_BYTES_SIZE),
    isMoreValidator ? validatorsBytes2.subarray(0, minValidatorCount * VALIDATOR_BYTES_SIZE) : validatorsBytes2,
    modifiedValidators
  );
  for (const i of modifiedValidators) {
    newState.validators.set(
      i,
      ssz.phase0.Validator.deserializeToViewDU(
        validatorsBytes2.subarray(i * VALIDATOR_BYTES_SIZE, (i + 1) * VALIDATOR_BYTES_SIZE)
      )
    );
  }

  if (newValidatorCount >= oldValidatorCount) {
    // add new validators
    for (let validatorIndex = oldValidatorCount; validatorIndex < newValidatorCount; validatorIndex++) {
      newState.validators.push(
        ssz.phase0.Validator.deserializeToViewDU(
          validatorsBytes2.subarray(validatorIndex * VALIDATOR_BYTES_SIZE, (validatorIndex + 1) * VALIDATOR_BYTES_SIZE)
        )
      );
      modifiedValidators.push(validatorIndex);
    }
  } else {
    newState.validators = newState.validators.sliceTo(newValidatorCount - 1);
  }
  newState.commit();
  return newState;
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
