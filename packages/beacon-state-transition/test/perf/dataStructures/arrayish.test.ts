import {LeafNode, toGindex, Tree, zeroNode} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {itBench, setBenchOpts} from "@dapplion/benchmark";

// Understand the cost of each array-ish data structure to:
// - Get one element
// - Set one element
// - Get all elements
// - Set all elements (re-create the array)
// - Clone the array for immutable editing
// - Memory cost of a full array

// Benchmark data from Aug 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
// Tree (persistent-merkle-tree)
// ✓ Tree 40 250000 create                                              0.9570626 ops/s    1.044864  s/op        -          9 runs   10.4 s
// ✓ Tree 40 250000 get(0)                                               621118.0 ops/s    1.610000 us/op        -     527363 runs   1.03 s
// ✓ Tree 40 250000 get(249999)                                          600961.5 ops/s    1.664000 us/op        -     512426 runs   1.03 s
// ✓ Tree 40 250000 set(0)                                               244978.0 ops/s    4.082000 us/op        -     227418 runs   1.01 s
// ✓ Tree 40 250000 set(249999)                                          197083.2 ops/s    5.074000 us/op        -     183365 runs   1.01 s
// ✓ Tree 40 250000 toArray()                                            13.48403 ops/s    74.16183 ms/op        -        134 runs   10.0 s
// ✓ Tree 40 250000 iterate all - toArray() + loop                       13.78103 ops/s    72.56350 ms/op        -        137 runs   10.0 s
// ✓ Tree 40 250000 iterate all - get(i)                                 2.820850 ops/s    354.5030 ms/op        -         28 runs   10.3 s

// MutableVector
// ✓ MutableVector 250000 create                                         60.84465 ops/s    16.43530 ms/op        -        609 runs   10.0 s
// ✓ MutableVector 250000 get(0)                                          1893939 ops/s    528.0000 ns/op        -    1150568 runs   1.07 s
// ✓ MutableVector 250000 get(249999)                                     1953125 ops/s    512.0000 ns/op        -    1176768 runs   1.08 s
// ✓ MutableVector 250000 set(0)                                         811030.0 ops/s    1.233000 us/op        -     637508 runs   1.04 s
// ✓ MutableVector 250000 set(249999)                                     1579779 ops/s    633.0000 ns/op        -    1011919 runs   1.18 s
// ✓ MutableVector 250000 toArray()                                      134.9621 ops/s    7.409485 ms/op        -       1024 runs   7.59 s
// ✓ MutableVector 250000 iterate all - toArray() + loop                 117.5826 ops/s    8.504657 ms/op        -       1024 runs   8.71 s
// ✓ MutableVector 250000 iterate all - get(i)                           274.0159 ops/s    3.649423 ms/op        -       1024 runs   3.74 s

// Array
// ✓ Array 250000 create                                                 182.7870 ops/s    5.470849 ms/op        -       1024 runs   5.61 s
// ✓ Array 250000 clone - spread                                         549.0822 ops/s    1.821221 ms/op        -       1024 runs   1.87 s
// ✓ Array 250000 get(0)                                                  1968504 ops/s    508.0000 ns/op        -    1176396 runs   1.09 s
// ✓ Array 250000 get(249999)                                             2032520 ops/s    492.0000 ns/op        -    1200057 runs   1.17 s
// ✓ Array 250000 set(0)                                                  2100840 ops/s    476.0000 ns/op        -    1248220 runs   1.08 s
// ✓ Array 250000 set(249999)                                             2100840 ops/s    476.0000 ns/op        -    1245961 runs   1.08 s
// ✓ Array 250000 iterate all - loop                                     3009.592 ops/s    332.2710 us/op        -       3006 runs   1.00 s

const n = 250_000;
const ih = Math.round(n / 2);
const runsFactor = 1000;

describe("Tree (persistent-merkle-tree)", () => {
  // Don't track regressions in CI
  setBenchOpts({noThreshold: true});

  const d = 40;
  const gih = toGindex(d, BigInt(ih));
  const n2 = new LeafNode(Buffer.alloc(32, 2));
  let tree: Tree;

  before(function () {
    this.timeout(120_000);
    tree = getTree(d, n);
  });

  itBench({id: `Tree ${d} ${n} create`, timeoutBench: 120_000}, () => {
    getTree(d, n);
  });

  itBench({id: `Tree ${d} ${n} get(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) tree.getNode(gih);
  });

  itBench({id: `Tree ${d} ${n} set(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) tree.setNode(gih, n2);
  });

  itBench(`Tree ${d} ${n} toArray()`, () => {
    Array.from(tree.iterateNodesAtDepth(d, 0, n));
  });

  itBench(`Tree ${d} ${n} iterate all - toArray() + loop`, () => {
    const treeArr = Array.from(tree.iterateNodesAtDepth(d, 0, n));
    for (let i = 0; i < n; i++) {
      treeArr[i];
    }
  });

  itBench(`Tree ${d} ${n} iterate all - get(i)`, () => {
    const startIndex = BigInt(2 ** d);
    for (let i = BigInt(0), nB = BigInt(n); i < nB; i++) {
      tree.getNode(startIndex + i);
    }
  });

  function getTree(d: number, n: number): Tree {
    const leaf = new LeafNode(Buffer.alloc(32, 1));
    const startIndex = BigInt(2 ** d);
    const tree = new Tree(zeroNode(d));
    for (let i = BigInt(0), nB = BigInt(n); i < nB; i++) {
      tree.setNode(startIndex + i, leaf);
    }
    return tree;
  }
});

describe("MutableVector", () => {
  // Don't track regressions in CI
  setBenchOpts({noThreshold: true});

  let items: number[];
  let mutableVector: MutableVector<number>;

  before(function () {
    items = createArray(n);
    mutableVector = MutableVector.from(items);
  });

  itBench(`MutableVector ${n} create`, () => {
    MutableVector.from(items);
  });

  itBench({id: `MutableVector ${n} get(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) mutableVector.get(ih - i);
  });

  itBench({id: `MutableVector ${n} set(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) mutableVector.set(ih - i, 10000000);
  });

  itBench(`MutableVector ${n} toArray()`, () => {
    mutableVector.toArray();
  });

  itBench(`MutableVector ${n} iterate all - toArray() + loop`, () => {
    const mvArr = mutableVector.toArray();
    for (let i = 0; i < n; i++) {
      mvArr[i];
    }
  });

  itBench(`MutableVector ${n} iterate all - get(i)`, () => {
    for (let i = 0; i < n; i++) {
      mutableVector.get(i);
    }
  });
});

describe("Array", () => {
  // Don't track regressions in CI
  setBenchOpts({noThreshold: true});

  let arr: number[];

  before(function () {
    arr = createArray(n);
  });

  itBench(`Array ${n} create`, () => {
    createArray(n);
  });

  itBench(`Array ${n} clone - spread`, () => {
    [...arr];
  });

  itBench({id: `Array ${n} get(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) arr[ih - 1];
  });

  itBench({id: `Array ${n} set(${ih})`, runsFactor}, () => {
    for (let i = 0; i < runsFactor; i++) arr[ih - 1] = 10000000;
  });

  itBench(`Array ${n} iterate all - loop`, () => {
    for (let i = 0; i < n; i++) {
      arr[i];
    }
  });
});

function createArray(n: number): number[] {
  const items: number[] = [];
  for (let i = 0; i < n; i++) {
    items.push(i);
  }
  return items;
}
