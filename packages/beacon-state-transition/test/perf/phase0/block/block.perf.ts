import {init} from "@chainsafe/bls";
import {MAX_VOLUNTARY_EXITS} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {List} from "@chainsafe/ssz";
import {allForks} from "../../../../src";
import {generatePerformanceBlock, generatePerfTestCachedBeaconState} from "../../util";

// As of Jun 01 2021
// Process block
// ================================================================
// Jun-02 16:03:37.475 []                 info: Loaded block slot=756417
// Process regular block                                                  212.0753 ops/s       4715307 ns/op    100 runs
// Process blocks with [object Object] validator exits                    1.960872 ops/s   5.099772e+8 ns/op    100 runs

export async function runBlockTransitionTests(): Promise<void> {
  const runner = new BenchmarkRunner("Process block", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });
  await init("blst-native");

  const originalState = generatePerfTestCachedBeaconState() as allForks.CachedBeaconState<allForks.BeaconState>;
  const signedBlock = generatePerformanceBlock();
  const validatorExitsBlock = signedBlock.clone();
  const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
  const numValidatorExits = MAX_VOLUNTARY_EXITS;
  const exitEpoch = originalState.epochCtx.currentShuffling.epoch;
  for (let i = 0; i < numValidatorExits; i++) {
    voluntaryExits.push({
      message: {epoch: exitEpoch, validatorIndex: 40000 + i},
      signature: Buffer.alloc(96),
    });
  }
  validatorExitsBlock.message.body.voluntaryExits = (voluntaryExits as unknown) as List<phase0.SignedVoluntaryExit>;

  const testCases = [
    {signedBlock, name: "Process regular block"},
    {signedBlock: validatorExitsBlock, name: `Process block with ${numValidatorExits} validator exits`},
  ];

  for (const {name, signedBlock} of testCases) {
    await runner.run({
      id: name,
      beforeEach: () => originalState.clone(),
      run: (state) => {
        allForks.stateTransition(state, signedBlock, {
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
        });
      },
    });
  }

  runner.done();
}
