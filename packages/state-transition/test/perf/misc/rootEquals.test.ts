import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {byteArrayEquals, fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

// As of Sep 2023
// root equals
// ✔ ssz.Root.equals                                                  2.703872e+7 ops/s    36.98400 ns/op        -      74234 runs   2.83 s
// ✔ byteArrayEquals                                                  2.773617e+7 ops/s    36.05400 ns/op        -      15649 runs  0.606 s
// ✔ Buffer.compare                                                   7.099247e+7 ops/s    14.08600 ns/op        -      26965 runs  0.404 s

describe("root equals", () => {
  setBenchOpts({noThreshold: true});

  const stateRoot = fromHexString("0x6c86ca3c4c6688cf189421b8a68bf2dbc91521609965e6f4e207d44347061fee");
  const rootTree = ssz.Root.toViewDU(stateRoot);

  // This benchmark is very unstable in CI. We already know that "ssz.Root.equals" is the fastest
  const runsFactor = 1000;
  itBench({
    id: "ssz.Root.equals",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        ssz.Root.equals(rootTree, stateRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "byteArrayEquals",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        byteArrayEquals(rootTree, stateRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "Buffer.compare",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        Buffer.compare(rootTree, stateRoot);
      }
    },
    runsFactor,
  });
});
