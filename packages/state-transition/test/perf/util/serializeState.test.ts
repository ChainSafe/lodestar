import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ssz} from "@lodestar/types";
import {generatePerfTestCachedStateAltair} from "../util.js";

/**
 * This shows different statistics between allocating memory once vs every time.
 * Due to gc, the test is not consistent so skipping it for CI.
 */
describe.skip("serialize state and validators", function () {
  this.timeout(0);

  setBenchOpts({
    // increasing this may have different statistics due to gc time
    minMs: 60_000,
  });
  const valicatorCount = 1_500_000;
  const seedState = generatePerfTestCachedStateAltair({vc: 1_500_000, goBackOneSlot: false});

  /**
   * Allocate memory every time, on a Mac M1:
   * - 700ms to 750ms
   * - Used to see 2.8s
   * Allocate memory once, may test multiple times but seems consistent:
   * - 430ms to 480ms
   */
  const stateType = ssz.altair.BeaconState;
  const rootNode = seedState.node;
  const stateBytes = new Uint8Array(stateType.tree_serializedSize(rootNode));
  const stateDataView = new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
  itBench({
    id: `serialize state ${valicatorCount} validators, alloc once`,
    fn: () => {
      stateType.tree_serializeToBytes({uint8Array: stateBytes, dataView: stateDataView}, 0, rootNode);
    },
  });

  itBench({
    id: `serialize altair state ${valicatorCount} validators`,
    fn: () => {
      seedState.serialize();
    },
  });

  /**
   * Allocate memory once, this takes 450ms - 500ms on a Mac M1.
   */
  const validatorsType = seedState.type.fields.validators;
  const validatorsSize = validatorsType.tree_serializedSize(seedState.validators.node);
  const validatorsBytes = new Uint8Array(validatorsSize);
  const validatorsDataView = new DataView(
    validatorsBytes.buffer,
    validatorsBytes.byteOffset,
    validatorsBytes.byteLength
  );
  itBench({
    id: `serialize state validators ${valicatorCount} validators, alloc once`,
    fn: () => {
      validatorsType.tree_serializeToBytes(
        {uint8Array: validatorsBytes, dataView: validatorsDataView},
        0,
        seedState.validators.node
      );
    },
  });

  /**
   * Allocate memory every time, this takes 640ms to more than 1s on a Mac M1.
   */
  itBench({
    id: `serialize state validators ${valicatorCount} validators`,
    fn: () => {
      seedState.validators.serialize();
    },
  });

  /**
   * Allocating once and populate validators nodes once, this takes 120ms - 150ms on a Mac M1,
   * this is 3x faster than the previous approach.
   */
  const NUMBER_2_POW_32 = 2 ** 32;
  const output = new Uint8Array(121 * 1_500_000);
  const dataView = new DataView(output.buffer, output.byteOffset, output.byteLength);
  // this caches validators nodes which is what happen after we run a state transition
  const validators = seedState.validators.getAllReadonlyValues();
  itBench({
    id: `serialize ${valicatorCount} validators manually`,
    fn: () => {
      let offset = 0;
      for (const validator of validators) {
        output.set(validator.pubkey, offset);
        offset += 48;
        output.set(validator.withdrawalCredentials, offset);
        offset += 32;
        const {effectiveBalance, activationEligibilityEpoch, activationEpoch, exitEpoch, withdrawableEpoch} = validator;
        dataView.setUint32(offset, effectiveBalance & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, (effectiveBalance / NUMBER_2_POW_32) & 0xffffffff, true);
        offset += 4;
        output[offset] = validator.slashed ? 1 : 0;
        offset += 1;
        dataView.setUint32(offset, activationEligibilityEpoch & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, (activationEligibilityEpoch / NUMBER_2_POW_32) & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, activationEpoch & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, (activationEpoch / NUMBER_2_POW_32) & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, exitEpoch & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, (exitEpoch / NUMBER_2_POW_32) & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, withdrawableEpoch & 0xffffffff, true);
        offset += 4;
        dataView.setUint32(offset, (withdrawableEpoch / NUMBER_2_POW_32) & 0xffffffff, true);
        offset += 4;
      }
    },
  });
});
