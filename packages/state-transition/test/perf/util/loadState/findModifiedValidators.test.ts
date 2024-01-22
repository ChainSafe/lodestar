import {expect} from "chai";
import {itBench} from "@dapplion/benchmark";
import {CompositeViewDU} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {findModifiedValidators} from "../../../../src/util/loadState/findModifiedValidators.js";
import {VALIDATOR_BYTES_SIZE} from "../../../../src/util/sszBytes.js";
import {generateValidators} from "../../../utils/validator.js";
import {generateState} from "../../../utils/state.js";

/**
 *  find modified validators by different ways. This proves that findModifiedValidators() leveraging Buffer.compare() is the fastest way.
 *    - Method 0 - serialize validators then findModifiedValidators, this is the selected implementation
 *      ✔ findModifiedValidators - 10000 modified validators                  2.261799 ops/s    442.1260 ms/op        -         14 runs   7.80 s
 *      ✔ findModifiedValidators - 1000 modified validators                   2.310899 ops/s    432.7321 ms/op        -         12 runs   6.35 s
 *      ✔ findModifiedValidators - 100 modified validators                    2.259907 ops/s    442.4960 ms/op        -         16 runs   7.93 s
 *      ✔ findModifiedValidators - 10 modified validators                     2.297018 ops/s    435.3470 ms/op        -         12 runs   6.23 s
 *      ✔ findModifiedValidators - 1 modified validators                      2.344447 ops/s    426.5398 ms/op        -         12 runs   5.81 s
 *      ✔ findModifiedValidators - no difference                              2.327252 ops/s    429.6914 ms/op        -         12 runs   5.70 s
 *
 *    - Method 1 - deserialize validators then compare validator ViewDUs: 8.8x slower
 *      ✔ compare ViewDUs                                                    0.2643101 ops/s    3.783434  s/op        -         12 runs   50.3 s
 *
 *    - Method 2 - serialize each validator then compare Uin8Array: 3.1x slower
 *      ✔ compare each validator Uint8Array                                  0.7424619 ops/s    1.346870  s/op        -         12 runs   17.8 s
 *
 *    - Method 3 - compare validator ViewDU to Uint8Array: 3x slower
 *      ✔ compare ViewDU to Uint8Array                                       0.7791557 ops/s    1.283441  s/op        -         12 runs   16.8 s
 */
describe("find modified validators by different ways", function () {
  this.timeout(0);
  // To get state bytes from any persisted state, do this:
  // const stateBytes = new Uint8Array(fs.readFileSync(path.join(folder, "mainnet_state_7335296.ssz")));
  // const stateType = ssz.capella.BeaconState;
  const numValidator = 1_000_000;
  const validators = generateValidators(numValidator);
  const state = generateState({validators: validators});
  const stateType = ssz.phase0.BeaconState;
  const stateBytes = state.serialize();

  // const state = stateType.deserializeToViewDU(stateBytes);
  const dataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
  const fieldRanges = stateType.getFieldRanges(dataView, 0, stateBytes.length);
  const validatorsFieldIndex = Object.keys(stateType.fields).indexOf("validators");
  const validatorsRange = fieldRanges[validatorsFieldIndex];

  describe("serialize validators then findModifiedValidators", () => {
    const expectedModifiedValidatorsArr: number[][] = [
      // mainnet state has 700k validators as of Sep 2023
      Array.from({length: 10_000}, (_, i) => 70 * i),
      Array.from({length: 1_000}, (_, i) => 700 * i),
      Array.from({length: 100}, (_, i) => 700 * i),
      Array.from({length: 10}, (_, i) => 700 * i),
      Array.from({length: 1}, (_, i) => 10 * i),
      [],
    ];
    for (const expectedModifiedValidators of expectedModifiedValidatorsArr) {
      const prefix = "findModifiedValidators";
      const testCaseName =
        expectedModifiedValidators.length === 0
          ? "no difference"
          : expectedModifiedValidators.length + " modified validators";
      itBench({
        id: `${prefix} - ${testCaseName}`,
        beforeEach: () => {
          const clonedState = state.clone();
          for (const validatorIndex of expectedModifiedValidators) {
            clonedState.validators.get(validatorIndex).pubkey = Buffer.alloc(48, 0);
          }
          clonedState.commit();
          return clonedState;
        },
        fn: (clonedState) => {
          const validatorsBytes = Uint8Array.from(stateBytes.subarray(validatorsRange.start, validatorsRange.end));
          const validatorsBytes2 = clonedState.validators.serialize();
          const modifiedValidators: number[] = [];
          findModifiedValidators(validatorsBytes, validatorsBytes2, modifiedValidators);
          expect(modifiedValidators.sort((a, b) => a - b)).to.be.deep.equal(expectedModifiedValidators);
        },
      });
    }
  });

  describe("deserialize validators then compare validator ViewDUs", () => {
    const validatorsBytes = stateBytes.subarray(validatorsRange.start, validatorsRange.end);
    itBench("compare ViewDUs", () => {
      const numValidator = state.validators.length;
      const validators = stateType.fields.validators.deserializeToViewDU(validatorsBytes);
      for (let i = 0; i < numValidator; i++) {
        if (!ssz.phase0.Validator.equals(state.validators.get(i), validators.get(i))) {
          throw Error(`validator ${i} is not equal`);
        }
      }
    });
  });

  describe("serialize each validator then compare Uin8Array", () => {
    const validators = state.validators.getAllReadonly();
    itBench("compare each validator Uint8Array", () => {
      for (let i = 0; i < state.validators.length; i++) {
        const validatorBytes = ssz.phase0.Validator.serialize(validators[i]);
        if (
          Buffer.compare(
            validatorBytes,
            stateBytes.subarray(
              validatorsRange.start + i * VALIDATOR_BYTES_SIZE,
              validatorsRange.start + (i + 1) * VALIDATOR_BYTES_SIZE
            )
          ) !== 0
        ) {
          throw Error(`validator ${i} is not equal`);
        }
      }
    });
  });

  describe("compare validator ViewDU to Uint8Array", () => {
    itBench("compare ViewDU to Uint8Array", () => {
      const numValidator = state.validators.length;
      for (let i = 0; i < numValidator; i++) {
        const diff = validatorDiff(
          state.validators.get(i),
          stateBytes.subarray(
            validatorsRange.start + i * VALIDATOR_BYTES_SIZE,
            validatorsRange.start + (i + 1) * VALIDATOR_BYTES_SIZE
          )
        );

        if (diff !== null) {
          throw Error(`validator ${i} is not equal at ${diff}`);
        }
      }
    });
  });
});

function validatorDiff(validator: CompositeViewDU<typeof ssz.phase0.Validator>, bytes: Uint8Array): string | null {
  const pubkey = bytes.subarray(0, 48);
  if (Buffer.compare(validator.pubkey, pubkey) !== 0) {
    return "pubkey";
  }

  const withdrawalCredentials = bytes.subarray(48, 80);
  if (Buffer.compare(validator.withdrawalCredentials, withdrawalCredentials) !== 0) {
    return "withdrawalCredentials";
  }

  if (validator.effectiveBalance !== bytesToInt(bytes.subarray(80, 88))) {
    return "effectiveBalance";
  }

  if (validator.slashed !== Boolean(bytes[88])) {
    return "slashed";
  }

  if (validator.activationEligibilityEpoch !== toNumberOrInfinity(bytes.subarray(89, 97))) {
    return "activationEligibilityEpoch";
  }

  if (validator.activationEpoch !== toNumberOrInfinity(bytes.subarray(97, 105))) {
    return "activationEpoch";
  }

  if (validator.exitEpoch !== toNumberOrInfinity(bytes.subarray(105, 113))) {
    return "exitEpoch";
  }

  if (validator.withdrawableEpoch !== toNumberOrInfinity(bytes.subarray(113, 121))) {
    return "withdrawableEpoch";
  }

  return null;
}

function toNumberOrInfinity(bytes: Uint8Array): number {
  let isInfinity = true;
  for (const byte of bytes) {
    if (byte !== 255) {
      isInfinity = false;
      break;
    }
  }

  return isInfinity ? Infinity : bytesToInt(bytes);
}
