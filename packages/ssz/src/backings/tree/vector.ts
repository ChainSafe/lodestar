import {Node, TreeBacking, subtreeFillToLength, zeroNode} from "@chainsafe/merkle-tree";

import {Vector} from "../../interface";
import {BasicVectorType, CompositeVectorType} from "../../types";
import {BasicArrayTreeHandler, CompositeArrayTreeHandler} from "./array";

export class BasicVectorTreeHandler<T extends Vector<any>> extends BasicArrayTreeHandler<T> {
  _type: BasicVectorType<T>;
  constructor(type: BasicVectorType<T>) {
    super();
    this._type = type;
  }
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = subtreeFillToLength(
        zeroNode(0),
        this.depth(),
        this._type.chunkCount()
      );
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return this._type.length;
  }
}
export class CompositeVectorTreeHandler<T extends Vector<any>> extends CompositeArrayTreeHandler<T> {
  _type: CompositeVectorType<T>;
  constructor(type: CompositeVectorType<T>) {
    super();
    this._type = type;
  }
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = subtreeFillToLength(
        this._type.elementType.tree.defaultNode(),
        this.depth(),
        this._type.length
      );
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return this._type.length;
  }
}
