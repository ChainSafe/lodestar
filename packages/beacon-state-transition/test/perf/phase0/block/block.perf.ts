import {init} from "@chainsafe/bls";
import {MAX_VOLUNTARY_EXITS} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {List} from "@chainsafe/ssz";
import {allForks} from "../../../../src";
import {generatePerformanceBlock, generatePerfTestCachedBeaconState} from "../../util";

// As of Jun 12 2021
// Process block
// ================================================================
// Process block with 0 validator exit                                    233.6434 ops/s      4.280027 ms/op   3491 runs    15.01 s
// Process block with 1 validator exit                                    41.33581 ops/s      24.19210 ms/op    619 runs    15.00 s
// Process block with 16 validator exits                                  42.34492 ops/s      23.61558 ms/op    635 runs    15.02 s

export async function runBlockTransitionTests(): Promise<void> {
  const runner = new BenchmarkRunner("Process block", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });
  await init("blst-native");

  const originalState = generatePerfTestCachedBeaconState() as allForks.CachedBeaconState<allForks.BeaconState>;
  const regularBlock = generatePerformanceBlock();
  const [oneValidatorExitBlock, maxValidatorExitBlock] = [1, MAX_VOLUNTARY_EXITS].map((numValidatorExits) => {
    const signedBlock = regularBlock.clone();
    const exitEpoch = originalState.epochCtx.currentShuffling.epoch;
    const voluntaryExits: phase0.SignedVoluntaryExit[] = [];
    for (let i = 0; i < numValidatorExits; i++) {
      voluntaryExits.push({
        message: {epoch: exitEpoch, validatorIndex: 40000 + i},
        signature: Buffer.alloc(96),
      });
    }
    signedBlock.message.body.voluntaryExits = (voluntaryExits as unknown) as List<phase0.SignedVoluntaryExit>;
    return signedBlock;
  });

  const testCases = [
    {signedBlock: regularBlock, name: "Process block with 0 validator exit"},
    {signedBlock: oneValidatorExitBlock, name: "Process block with 1 validator exit"},
    {signedBlock: maxValidatorExitBlock, name: `Process block with ${MAX_VOLUNTARY_EXITS} validator exits`},
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
