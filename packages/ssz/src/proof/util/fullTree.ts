import {hash} from "../../util/hash";
import {bitLength, previousPowerOf2, nextPowerOf2} from "../../util/math";
import {zeroHashes} from "../../util/zeros";

export function calcMerkleTreeFromLeaves(values: Buffer[], layerCount: number = 32): Buffer[][] {
  const tree = [values.slice()];
  for (let i = 0; i < layerCount; i++) {
    if (values.length % 2 === 1) {
      values.push(zeroHashes[i]);
    }
    for (let i = 0; i < values.length - 1; i+=2) {
      values[i] = hash(Buffer.concat([
        values[i],
        values[i+1],
      ]));
    }
    tree.push(values.slice());
  }
  return tree;
}

export function getMerkleTree(values: Buffer[], padTo: number = 0): Buffer[][] {
  const layerCount = bitLength(nextPowerOf2(padTo || values.length) - 1);
  if (values.length === 0) {
    return [[zeroHashes[layerCount]]];
  }
  return calcMerkleTreeFromLeaves(values, layerCount);
}

export function getMerkleRoot(values: Buffer[], padTo: number = 1): Buffer {
  if (padTo === 0) {
    return zeroHashes[0];
  }
  const layerCount = previousPowerOf2(padTo);
  if (values.length === 0) {
    return zeroHashes[layerCount];
  }
  const tree = calcMerkleTreeFromLeaves(values, layerCount);
  return tree[tree.length - 1][0];
}

export function getMerkleProof(tree: Buffer[][], itemIndex: number, treeLength: number = null): Buffer[]  {
  const proof = [];
  treeLength = treeLength === null ? tree.length : treeLength;
  for (let i = 0; i < treeLength; i++) {
    const subIndex = Math.floor(itemIndex / Math.pow(2, i)) ^ 1;
    proof.push(
      subIndex < tree[i].length ? tree[i][subIndex] : zeroHashes[i]
    );
  }
  return proof;
}

