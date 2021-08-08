import {LeafNode, toGindex, Tree, zeroNode} from "@chainsafe/persistent-merkle-tree";
import {MutableVector} from "@chainsafe/persistent-ts";
import {itBench, setBenchOpts} from "@dapplion/benchmark";

const n = 250_000;
const ilo = 0;
const ihi = n - 1;

// Understand the cost of each array-ish data structure to:
// - Get one element
// - Set one element
// - Get all elements
// - Set all elements (re-create the array)
// - Clone the array for immutable editing
// - Memory cost of a full array

// Benchmark data from Aug 2021 - Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz
// MutableVector
// ✓ MutableVector 250000 create                                         69.60118 ops/s    14.36757 ms/op   x1.078        695 runs   10.0 s
// ✓ MutableVector 250000 get(0)                                          2277904 ops/s    439.0000 ns/op   x1.149    1427700 runs   1.07 s
// ✓ MutableVector 250000 set(0)                                          1055966 ops/s    947.0000 ns/op   x1.205     825882 runs   1.04 s
// ✓ MutableVector 250000 get(249999)                                     2469136 ops/s    405.0000 ns/op   x1.134    1464511 runs   1.07 s
// ✓ MutableVector 250000 set(249999)                                     1912046 ops/s    523.0000 ns/op   x1.236    1227883 runs   1.06 s
// ✓ MutableVector 250000 toArray()                                      173.7822 ops/s    5.754330 ms/op        -       1024 runs   5.90 s
// ✓ MutableVector 250000 iterate all - toArray() + loop                 165.5760 ops/s    6.039522 ms/op        -       1024 runs   6.19 s
// ✓ MutableVector 250000 iterate all - get(i)                           342.0903 ops/s    2.923205 ms/op   x1.081       1024 runs   2.99 s

// Array
// ✓ Array 250000 create                                                 238.7041 ops/s    4.189287 ms/op   x0.941       1024 runs   4.29 s
// ✓ Array 250000 get(0)                                                  2604167 ops/s    384.0000 ns/op   x0.798    1557414 runs   1.07 s
// ✓ Array 250000 set(0)                                                  2427184 ops/s    412.0000 ns/op   x0.846    1429521 runs   1.07 s
// ✓ Array 250000 get(249999)                                             2652520 ops/s    377.0000 ns/op   x0.684    1588011 runs   1.07 s
// ✓ Array 250000 set(249999)                                             2398082 ops/s    417.0000 ns/op   x0.993    1437819 runs   1.07 s
// ✓ Array 250000 iterate all - loop                                     3784.639 ops/s    264.2260 us/op   x0.898       3774 runs   1.00 s

describe("Tree (persistent-merkle-tree)", () => {
  // Don't run on CI
  if (process.env.CI) return;

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  const d = 40;
  const tree = getTree(d, n);
  const gilo = toGindex(d, BigInt(ilo));
  const gihi = toGindex(d, BigInt(ihi));
  const n2 = new LeafNode(Buffer.alloc(32, 2));

  itBench(`Tree ${d} ${n} create`, () => {
    getTree(d, n);
  });

  itBench(`Tree ${d} ${n} get(${ilo})`, () => {
    tree.getNode(gilo);
  });

  itBench(`Tree ${d} ${n} get(${ihi})`, () => {
    tree.getNode(gihi);
  });

  itBench(`Tree ${d} ${n} get(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) tree.getNode(gihi);
  });

  itBench(`Tree ${d} ${n} set(${ilo})`, () => {
    tree.setNode(gilo, n2);
  });

  itBench(`Tree ${d} ${n} set(${ihi})`, () => {
    tree.setNode(gihi, n2);
  });

  itBench(`Tree ${d} ${n} set(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) tree.setNode(gihi, n2);
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
  // Don't run on CI
  if (process.env.CI) return;

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  const items = createArray(n);
  const mutableVector = MutableVector.from(items);

  itBench(`MutableVector ${n} create`, () => {
    MutableVector.from(items);
  });

  itBench(`MutableVector ${n} get(${ilo})`, () => {
    mutableVector.get(ilo);
  });

  itBench(`MutableVector ${n} get(${ihi})`, () => {
    mutableVector.get(ihi);
  });

  itBench(`MutableVector ${n} get(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) mutableVector.get(ihi - i);
  });

  itBench(`MutableVector ${n} set(${ilo})`, () => {
    mutableVector.set(ilo, 10000000);
  });

  itBench(`MutableVector ${n} set(${ihi})`, () => {
    mutableVector.set(ihi, 10000000);
  });

  itBench(`MutableVector ${n} set(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) mutableVector.set(ihi - i, 10000000);
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
  // Don't run on CI
  if (process.env.CI) return;

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  const arr = createArray(n);

  itBench(`Array ${n} create`, () => {
    createArray(n);
  });

  itBench(`Array ${n} clone - spread`, () => {
    [...arr];
  });

  itBench(`Array ${n} get(${ilo})`, () => {
    arr[ilo];
  });

  itBench(`Array ${n} get(${ihi})`, () => {
    arr[ihi];
  });

  itBench(`Array ${n} get(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) arr[ihi - 1];
  });

  itBench(`Array ${n} set(${ilo})`, () => {
    arr[ilo] = 10000000;
  });

  itBench(`Array ${n} set(${ihi})`, () => {
    arr[ihi] = 10000000;
  });

  itBench(`Array ${n} set(${ihi}) x1000`, () => {
    for (let i = 0; i < 1000; i++) arr[ihi - 1] = 10000000;
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
