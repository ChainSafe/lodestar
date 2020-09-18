import {TreeBacked, List} from "@chainsafe/ssz";

export function getTreeAtIndex<T>(tree: TreeBacked<List<T>>, index: number): TreeBacked<List<T>> {
  const newTree = tree.clone();
  let maxIndex = newTree.length - 1;
  if (index > maxIndex) {
    throw new Error(`Cannot get tree for index: ${index}, maxIndex: ${maxIndex}`);
  }
  while (maxIndex > index) {
    newTree.pop();
    maxIndex = newTree.length - 1;
  }
  return newTree;
}
