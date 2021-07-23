import {phase0, ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {itBench, setBenchOpts} from "@dapplion/benchmark";

// Benchmark data from July 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
//
// ✓ ssz.phase0.Eth1Data.equals                                          17059.32 ops/s    58.61900 us/op        -      84668 runs   5.01 s
// ✓ compare with serializeEth1Data                                      257201.6 ops/s    3.888000 us/op        -    1180606 runs   5.07 s

describe("eth1Data isEqual", () => {
  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 5 * 1000,
    runs: 1024,
  });

  const eth1Data1: phase0.Eth1Data = {
    depositRoot: Buffer.alloc(32, 1),
    depositCount: 1263512,
    blockHash: Buffer.alloc(32, 2),
  };

  // Almost identical eth1Data, just changes the last byte
  const eth1Data2: phase0.Eth1Data = {
    depositRoot: Buffer.alloc(32, 1),
    depositCount: 1263512,
    blockHash: Buffer.concat([Buffer.alloc(31, 2), Buffer.alloc(1, 3)]),
  };

  if (!process.env.CI) {
    itBench("ssz.phase0.Eth1Data.equals", () => {
      ssz.phase0.Eth1Data.equals(eth1Data1, eth1Data2);
    });

    itBench("compare with serializeEth1Data", () => {
      serializeEth1Data(eth1Data1) === serializeEth1Data(eth1Data2);
    });
  }
});

/**
 * Serialize eth1Data types to a unique string ID. It is only used for comparison.
 */
function serializeEth1Data(eth1Data: phase0.Eth1Data): string {
  return toHexString(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHexString(eth1Data.depositRoot);
}
