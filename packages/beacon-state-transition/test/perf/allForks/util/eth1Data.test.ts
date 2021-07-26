import {phase0, ssz} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {itBench, setBenchOpts} from "@dapplion/benchmark";

// Benchmark data from July 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
//
// eth1Data isEqual
// ✓ each field with ssz.Root.equals                                      1364256 ops/s    733.0000 ns/op        -    4619587 runs   5.28 s
// ✓ compare with serializeEth1Data                                      257267.8 ops/s    3.887000 us/op        -    1183689 runs   5.08 s
// ✓ ssz.phase0.Eth1Data.equals                                          16932.79 ops/s    59.05700 us/op        -      84084 runs   5.01 s

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
    itBench("each field with ssz.Root.equals", () => {
      eth1Data1.depositCount === eth1Data2.depositCount &&
        ssz.Root.equals(eth1Data1.depositRoot, eth1Data2.depositRoot) &&
        ssz.Root.equals(eth1Data1.blockHash, eth1Data2.blockHash);
    });

    itBench("compare with serializeEth1Data", () => {
      serializeEth1Data(eth1Data1) === serializeEth1Data(eth1Data2);
    });

    itBench("ssz.phase0.Eth1Data.equals", () => {
      ssz.phase0.Eth1Data.equals(eth1Data1, eth1Data2);
    });
  }
});

/**
 * Serialize eth1Data types to a unique string ID. It is only used for comparison.
 */
function serializeEth1Data(eth1Data: phase0.Eth1Data): string {
  return toHexString(eth1Data.blockHash) + eth1Data.depositCount.toString(16) + toHexString(eth1Data.depositRoot);
}
