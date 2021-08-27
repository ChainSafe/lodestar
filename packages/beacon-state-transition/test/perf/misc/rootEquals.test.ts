import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {ssz} from "@chainsafe/lodestar-types";
import {byteArrayEquals, fromHexString} from "@chainsafe/ssz";

// As of Jun 17 2021
// Compare state root
// ================================================================
// ssz.Root.equals                                                        891265.6 ops/s      1.122000 us/op 10017946 runs    15.66 s
// ssz.Root.equals with valueOf()                                         692041.5 ops/s      1.445000 us/op 8179741 runs    15.28 s
// byteArrayEquals with valueOf()                                         853971.0 ops/s      1.171000 us/op 9963051 runs    16.07 s

describe("root equals", () => {
  setBenchOpts({noThreshold: true});

  const stateRoot = fromHexString("0x6c86ca3c4c6688cf189421b8a68bf2dbc91521609965e6f4e207d44347061fee");
  const rootTree = ssz.Root.createTreeBackedFromStruct(stateRoot);

  // This benchmark is very unstable in CI. We already know that "ssz.Root.equals" is the fastest
  itBench("ssz.Root.equals", () => {
    ssz.Root.equals(rootTree, stateRoot);
  });

  itBench("ssz.Root.equals with valueOf()", () => {
    ssz.Root.equals(rootTree.valueOf() as Uint8Array, stateRoot);
  });

  itBench("byteArrayEquals with valueOf()", () => {
    byteArrayEquals(rootTree.valueOf() as Uint8Array, stateRoot);
  });
});
