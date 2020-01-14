import {Node, BranchNode, zeroNode, TreeBacking, LeafNode} from "@chainsafe/merkle-tree";

import {number32Type, BasicListType, CompositeListType} from "../../types";
import {BasicArrayTreeHandler, CompositeArrayTreeHandler} from "./array";

export class BasicListTreeHandler<T extends ArrayLike<any>> extends BasicArrayTreeHandler<T> {
  _type: BasicListType<T>;
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = new BranchNode(zeroNode(BigInt(super.depth())), zeroNode(BigInt(0)));
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return number32Type.fromBytes(target.get(BigInt(3)).merkleRoot, 0);
  }
  setLength(target: TreeBacking, length: number): void {
    const chunk = new Uint8Array(32);
    number32Type.serializeTo(length, chunk, 0);
    target.set(BigInt(3), new LeafNode(Buffer.from(chunk)));
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

export class CompositeListTreeHandler<T extends ArrayLike<any>> extends CompositeArrayTreeHandler<T> {
  _type: CompositeListType<T>;
  _defaultNode: Node;
  defaultNode(): Node {
    if (!this._defaultNode) {
      this._defaultNode = new BranchNode(zeroNode(BigInt(super.depth())), zeroNode(BigInt(0)));
    }
    return this._defaultNode;
  }
  getLength(target: TreeBacking): number {
    return number32Type.fromBytes(target.get(BigInt(3)).merkleRoot, 0);
  }
  setLength(target: TreeBacking, length: number): void {
    const chunk = new Uint8Array(32);
    number32Type.serializeTo(length, chunk, 0);
    target.set(BigInt(3), new LeafNode(Buffer.from(chunk)));
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
    super.set(target, length - 1, new TreeBacking(zeroNode(BigInt(0))));
    this.setLength(target, length - 1);
    return value;
  }
}
