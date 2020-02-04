import {Node, Tree, subtreeFillToLength, zeroNode} from "@chainsafe/merkle-tree";

import {Vector} from "../../interface";
import {BasicVectorType, CompositeVectorType} from "../../types";
import {BasicArrayTreeHandler, CompositeArrayTreeHandler} from "./array";
import {TreeBackedValue} from "./abstract";

export class BasicVectorTreeHandler<T extends Vector<unknown>> extends BasicArrayTreeHandler<T> {
  _type: BasicVectorType<T>;
  _defaultNode: Node;
  constructor(type: BasicVectorType<T>) {
    super();
    this._type = type;
  }
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
  defaultBacking(): Tree {
    return new Tree(this.defaultNode());
  }
  getLength(target: Tree): number {
    return this._type.length;
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    if ((end - start) !== this._type.size(null)) {
      throw new Error("Incorrect deserialized vector length");
    }
    return super.fromBytes(data, start, end);
  }
  setProperty(target: Tree, property: number, value: T[number]): boolean {
    if (property >= this.getLength(target)) {
      throw new Error("Invalid array index");
    }
    return super.setProperty(target, property, value, false);
  }
}

export class CompositeVectorTreeHandler<T extends Vector<object>> extends CompositeArrayTreeHandler<T> {
  _type: CompositeVectorType<T>;
  _defaultNode: Node;
  constructor(type: CompositeVectorType<T>) {
    super();
    this._type = type;
  }
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
  defaultBacking(): Tree {
    return new Tree(this.defaultNode());
  }
  getLength(target: Tree): number {
    return this._type.length;
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const target = this.defaultBacking();
    if (this._type.elementType.isVariableSize()) {
      const offsets = this._type.byteArray.getVariableOffsets(
        new Uint8Array(data.buffer, data.byteOffset + start, end - start)
      );
      if (offsets.length !== this._type.length) {
        throw new Error("Incorrect deserialized vector length");
      }
      for (let i = 0; i < offsets.length; i++) {
        const [currentOffset, nextOffset] = offsets[i];
        this.setSubtreeAtChunk(
          target,
          i,
          this._type.elementType.tree.fromBytes(
            data,
            start + currentOffset,
            start + nextOffset,
          ).backing(),
        );
      }
    } else {
      const elementSize = this._type.elementType.structural.size(null);
      const length = (end - start) / elementSize;
      if (length !== this._type.length) {
        throw new Error("Incorrect deserialized vector length");
      }
      for (let i = 0; i < length; i++) {
        this.setSubtreeAtChunk(
          target,
          i,
          this._type.elementType.tree.fromBytes(
            data,
            start + (i * elementSize),
            start + ((i+1) * elementSize),
          ).backing(),
        );
      }
    }
    return this.createBackedValue(target);
  }
  setProperty(target: Tree, property: number, value: T[number]): boolean {
    if (property >= this.getLength(target)) {
      throw new Error("Invalid array index");
    }
    return super.setProperty(target, property, value, false);
  }
}
