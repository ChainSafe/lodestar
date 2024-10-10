import path from "node:path";
import {RunnerType} from "../utils/types.js";
import {SkipOpts, specTestIterator} from "../utils/specTestIterator.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {blsTestRunner} from "./bls.js";
import {sszGeneric} from "./ssz_generic.js";

// NOTE: You MUST always provide a detailed reason of why a spec test is skipped plus link
// to an issue marking it as pending to re-enable and an aproximate timeline of when it will
// be fixed.
// NOTE: Comment the minimum set of test necessary to unblock PRs: For example, instead of
// skipping all `bls_to_execution_change` tests, just skip for a fork setting:
// ```
// skippedPrefixes: [
//    // Skipped since this only test that withdrawals are de-activated
//    "eip4844/operations/bls_to_execution_change",
// ],
// ```
const skipOpts: SkipOpts = {
  // Add kzg runner, tracked here: https://github.com/ChainSafe/lodestar/issues/5279
  skippedRunners: ["kzg"],
};

specTestIterator(
  path.join(ethereumConsensusSpecsTests.outputDir, "tests", "general"),
  {
    bls: {type: RunnerType.default, fn: blsTestRunner},
    ssz_generic: {
      type: RunnerType.custom,
      fn: sszGeneric([
        // NOTE: ComplexTestStruct tests are not correctly generated.
        // where deserialized .d value is D: '0x00'. However the tests guide mark that field as D: Bytes[256].
        // Those test won't be fixed since most implementations staticly compile types.
        "ComplexTestStruct",
      ]),
    },
  },
  skipOpts
);
