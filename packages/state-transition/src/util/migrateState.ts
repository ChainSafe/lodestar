import {CompositeViewDU} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

const stateType = ssz.capella.BeaconState;
const validatorBytesSize = 121;
export function migrateState(
  state: CompositeViewDU<typeof ssz.capella.BeaconState>,
  data: Uint8Array,
  modifiedValidators: number[] = []
): CompositeViewDU<typeof ssz.capella.BeaconState> {
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fieldRanges = stateType.getFieldRanges(dataView, 0, data.length);
  const clonedState = loadValidators(state, data, modifiedValidators);
  const allFields = Object.keys(stateType.fields);
  // genesisTime, could skip
  // genesisValidatorsRoot, could skip
  // validators is loaded above
  // inactivityScores
  // this takes ~500 to hashTreeRoot, should we only update individual field?
  const inactivityScoresIndex = allFields.indexOf("inactivityScores");
  const inactivityScoresRange = fieldRanges[inactivityScoresIndex];
  loadInactivityScores(clonedState, data.subarray(inactivityScoresRange.start, inactivityScoresRange.end));
  for (const [fieldName, type] of Object.entries(stateType.fields)) {
    const field = fieldName as keyof typeof stateType.fields;
    if (
      // same to all states
      field === "genesisTime" ||
      field === "genesisValidatorsRoot" ||
      // loaded above
      field === "validators" ||
      field === "inactivityScores"
    ) {
      continue;
    }
    const fieldIndex = allFields.indexOf(field);
    const fieldRange = fieldRanges[fieldIndex];
    if (type.isBasic) {
      clonedState[field] = type.deserialize(data.subarray(fieldRange.start, fieldRange.end)) as never;
    } else {
      clonedState[field] = type.deserializeToViewDU(data.subarray(fieldRange.start, fieldRange.end)) as never;
    }
  }
  clonedState.commit();

  return clonedState;
}

// state store inactivity scores of old seed state, we need to update it
// this value rarely changes even after 3 months of data as monitored on mainnet in Sep 2023
function loadInactivityScores(
  state: CompositeViewDU<typeof ssz.capella.BeaconState>,
  inactivityScoresBytes: Uint8Array
): void {
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
    // TODO: implement this in ssz?
    // state.inactivityScores = state.inactivityScores.sliceTo(newValidator - 1);
  }
}

function loadValidators(
  seedState: CompositeViewDU<typeof ssz.capella.BeaconState>,
  data: Uint8Array,
  modifiedValidators: number[] = []
): CompositeViewDU<typeof ssz.capella.BeaconState> {
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fieldRanges = stateType.getFieldRanges(dataView, 0, data.length);
  const validatorsFieldIndex = Object.keys(stateType.fields).indexOf("validators");
  const validatorsRange = fieldRanges[validatorsFieldIndex];
  const oldValidatorCount = seedState.validators.length;
  const newValidatorCount = (validatorsRange.end - validatorsRange.start) / validatorBytesSize;
  const isMoreValidator = newValidatorCount >= oldValidatorCount;
  const minValidatorCount = Math.min(oldValidatorCount, newValidatorCount);
  // new state now have same validators to seed state
  const newState = seedState.clone();
  const validatorsBytes = seedState.validators.serialize();
  const validatorsBytes2 = data.slice(validatorsRange.start, validatorsRange.end);
  findModifiedValidators(
    isMoreValidator ? validatorsBytes : validatorsBytes.subarray(0, minValidatorCount * validatorBytesSize),
    isMoreValidator ? validatorsBytes2.subarray(0, minValidatorCount * validatorBytesSize) : validatorsBytes2,
    modifiedValidators
  );
  for (const i of modifiedValidators) {
    newState.validators.set(
      i,
      ssz.phase0.Validator.deserializeToViewDU(
        validatorsBytes2.subarray(i * validatorBytesSize, (i + 1) * validatorBytesSize)
      )
    );
  }

  if (newValidatorCount >= oldValidatorCount) {
    // add new validators
    for (let validatorIndex = oldValidatorCount; validatorIndex < newValidatorCount; validatorIndex++) {
      newState.validators.push(
        ssz.phase0.Validator.deserializeToViewDU(
          validatorsBytes2.subarray(validatorIndex * validatorBytesSize, (validatorIndex + 1) * validatorBytesSize)
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

  if (validatorsBytes.length === validatorBytesSize) {
    modifiedValidators.push(validatorOffset);
    return;
  }

  const numValidator = Math.floor(validatorsBytes.length / validatorBytesSize);
  const halfValidator = Math.floor(numValidator / 2);
  findModifiedValidators(
    validatorsBytes.subarray(0, halfValidator * validatorBytesSize),
    validatorsBytes2.subarray(0, halfValidator * validatorBytesSize),
    modifiedValidators,
    validatorOffset
  );
  findModifiedValidators(
    validatorsBytes.subarray(halfValidator * validatorBytesSize),
    validatorsBytes2.subarray(halfValidator * validatorBytesSize),
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
