import {Node, BranchNode, zeroNode, TreeBacking, LeafNode} from "@chainsafe/merkle-tree";

import {List} from "../../interface";
import {number32Type, BasicListType, CompositeListType} from "../../types";
import {BasicArrayTreeHandler, CompositeArrayTreeHandler} from "./array";
import {TreeBackedValue} from "./abstract";

export class BasicListTreeHandler<T extends List<any>> extends BasicArrayTreeHandler<T> {
  _type: BasicListType<T>;
  constructor(type: BasicListType<T>) {
    super();
    this._type = type;
  }
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = new BranchNode(zeroNode(super.depth()), zeroNode(0));
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return number32Type.fromBytes(target.get(BigInt(3)).merkleRoot, 0);
  }
  setLength(target: TreeBacking, length: number): void {
    const chunk = new Uint8Array(32);
    number32Type.toBytes(length, chunk, 0);
    target.set(BigInt(3), new LeafNode(Buffer.from(chunk)));
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const length = (end - start) / this._type.elementType.size();
    if (length > this._type.limit) {
      throw new Error("Deserialized list length greater than limit");
    }
    const value = super.fromBytes(data, start, end);
    this.setLength(value.backing(), length);
    return value;
  }
  depth(): number {
    return super.depth() + 1;
  }
  set(target: TreeBacking, property: number, value: T[number]): boolean {
    const length = this.getLength(target);
    if (property > length) {
      throw new Error("Invalid length index");
    } else if (property == length) {
      this.push(target, value);
      return true;
    } else {
      return super.set(target, property, value);
    }
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    const length = this.getLength(target);
    if (property > length) {
      throw new Error("Invalid length index");
    } else if (property == length) {
      this.pop(target);
      return true;
    } else {
      return super.deleteProperty(target, property);
    }
  }
  push(target: TreeBacking, value: T[number]): number {
    const length = this.getLength(target);
    const expand = this.getChunkIndex(length) != this.getChunkIndex(length + 1);
    super.set(target, length, value, expand);
    this.setLength(target, length + 1);
    return length + 1;
  }
  pop(target: TreeBacking): T[number] {
    const length = this.getLength(target);
    const value = this.get(target, length - 1);
    super.deleteProperty(target, length - 1);
    this.setLength(target, length - 1);
    return value;
  }
}

export class CompositeListTreeHandler<T extends List<any>> extends CompositeArrayTreeHandler<T> {
  _type: CompositeListType<T>;
  constructor(type: CompositeListType<T>) {
    super();
    this._type = type;
  }
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = new BranchNode(zeroNode(super.depth()), zeroNode(0));
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return number32Type.fromBytes(target.get(BigInt(3)).merkleRoot, 0);
  }
  setLength(target: TreeBacking, length: number): void {
    const chunk = new Uint8Array(32);
    number32Type.toBytes(length, chunk, 0);
    target.set(BigInt(3), new LeafNode(Buffer.from(chunk)));
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const target = new TreeBacking(this.defaultNode());
    if (this._type.elementType.isVariableSize()) {
      const offsets = this._type.byteArray.getVariableOffsets(
        new Uint8Array(data.buffer, data.byteOffset + start, end - start)
      );
      if (offsets.length > this._type.limit) {
        throw new Error("Deserialized list length greater than limit");
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
      this.setLength(target, offsets.length);
    } else {
      const elementSize = this._type.elementType.structural.size(null);
      const length = (end - start) / elementSize;
      if (length > this._type.limit) {
        throw new Error("Deserialized list length greater than limit");
      }
      for (let i = 0; i < length; i++) {
        target.set(
          this.gindexOfChunk(target, i),
          this._type.elementType.tree.fromBytes(
            data,
            start + (i * elementSize),
            start + ((i+1) * elementSize),
          ).backing().node,
          true, // expand tree as needed
        );
      }
      this.setLength(target, length);
    }
    return this.createBackedValue(target);
  }
  depth(): number {
    return super.depth() + 1;
  }
  set(target: TreeBacking, property: number, value: T[number]): boolean {
    const length = this.getLength(target);
    if (property > length) {
      throw new Error("Invalid length index");
    } else if (property == length) {
      this.push(target, value);
      return true;
    } else {
      return super.set(target, property, value);
    }
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    const length = this.getLength(target);
    if (property > length) {
      throw new Error("Invalid length index");
    } else if (property == length) {
      this.pop(target);
      return true;
    } else {
      return super.deleteProperty(target, property);
    }
  }
  push(target: TreeBacking, value: T[number]): number {
    const length = this.getLength(target);
    super.set(target, length, value, true);
    this.setLength(target, length + 1);
    return length + 1;
  }
  pop(target: TreeBacking): T[number] {
    const length = this.getLength(target);
    const value = this.get(target, length - 1);
    super.set(target, length - 1, new TreeBacking(zeroNode(0)));
    this.setLength(target, length - 1);
    return value;
  }
}
