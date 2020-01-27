import {Node, TreeBacking, subtreeFillToLength, zeroNode} from "@chainsafe/merkle-tree";

import {Vector} from "../../interface";
import {BasicVectorType, CompositeVectorType} from "../../types";
import {BasicArrayTreeHandler, CompositeArrayTreeHandler} from "./array";
import {TreeBackedValue} from "./abstract";

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
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    if ((end - start) !== this._type.size(null)) {
      throw new Error("Incorrect deserialized vector length");
    }
    return super.fromBytes(data, start, end);
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
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const target = new TreeBacking(this.defaultNode());
    if (this._type.elementType.isVariableSize()) {
      const offsets = this._type.byteArray.getVariableOffsets(
        new Uint8Array(data.buffer, data.byteOffset + start, end - start)
      );
      if (offsets.length !== this._type.length) {
        throw new Error("Incorrect deserialized vector length");
      }
      for (let i = 0; i < offsets.length; i++) {
        const [currentOffset, nextOffset] = offsets[i];
        target.set(
          this.gindexOfChunk(target, i),
          this._type.elementType.fromBytes(
            data,
            start + currentOffset,
            start + nextOffset,
          ).backing().node,
        );
      }
    } else {
      const elementSize = this._type.elementType.structural.size(null);
      const length = (end - start) / elementSize;
      if (length !== this._type.length) {
        throw new Error("Incorrect deserialized vector length");
      }
      for (let i = 0; i < length; i++) {
        target.set(
          this.gindexOfChunk(target, i),
          this._type.elementType.tree.fromBytes(
            data,
            start + (i * elementSize),
            start + ((i+1) * elementSize),
          ).backing().node,
        );
      }
    }
    return this.createBackedValue(target);
  }
}
