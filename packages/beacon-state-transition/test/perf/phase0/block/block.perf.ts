import {init} from "@chainsafe/bls";
import {MAX_VOLUNTARY_EXITS} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {ssz} from "@chainsafe/lodestar-types";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {byteArrayEquals, List, fromHexString} from "@chainsafe/ssz";
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

// As of Jun 17 2021
// Compare state root
// ================================================================
// ssz.Root.equals                                                        891265.6 ops/s      1.122000 us/op 10017946 runs    15.66 s
// ssz.Root.equals with valueOf()                                         692041.5 ops/s      1.445000 us/op 8179741 runs    15.28 s
// byteArrayEquals with valueOf()                                         853971.0 ops/s      1.171000 us/op 9963051 runs    16.07 s
export async function runRootComparisonTests(): Promise<void> {
  await init("blst-native");
  const runner = new BenchmarkRunner("Compare state root", {
    maxMs: 60 * 1000,
    minMs: 15 * 1000,
    runs: 64,
  });
  const stateRoot = fromHexString("0x6c86ca3c4c6688cf189421b8a68bf2dbc91521609965e6f4e207d44347061fee");
  const signedBlock = generatePerformanceBlock();
  const blockStateRoot = signedBlock.message.stateRoot;
  await runner.run({
    id: "ssz.Root.equals",
    run: () => ssz.Root.equals(blockStateRoot, stateRoot),
  });
  await runner.run({
    id: "ssz.Root.equals with valueOf()",
    run: () => ssz.Root.equals(blockStateRoot.valueOf() as Uint8Array, stateRoot),
  });
  await runner.run({
    id: "byteArrayEquals with valueOf()",
    run: () => byteArrayEquals(blockStateRoot.valueOf() as Uint8Array, stateRoot),
  });
  runner.done();
}
