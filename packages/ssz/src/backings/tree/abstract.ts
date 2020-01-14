import {Node, TreeBacking, Gindex, toGindex, LeafNode, getDepth} from "@chainsafe/merkle-tree";

import {CompositeType} from "../../types";
import { isBackedValue, BackingType } from "..";

export interface ITreeBackedValue<T extends object> {
  type(): CompositeType<T>;

  clone(): TreeBackedValue<T>;
  equals(other: T): boolean;

  size(): number;
  serialize(): Uint8Array;
  serializeTo(output: Uint8Array, offset: number): number;

  hashTreeRoot(): Uint8Array;
  /*
  nonzeroChunkCount(): number;
  chunk(index: number): Uint8Array;
  chunks(): Iterable<Uint8Array>;
  */

  backingHandler(): TreeHandler<T>;
  backing(): TreeBacking;
  backingType(): BackingType;
}

export type TreeBackedValueify<T> = {
  [P in keyof T]: T[P] extends object ? TreeBackedValue<T[P]> : T[P];
};

export type TreeBackedValue<T extends object> = ITreeBackedValue<T> & TreeBackedValueify<T> & T;

export type PropOfBasicTreeBackedValue<T extends object, V extends keyof T> = T[V];

export type PropOfCompositeTreeBackedValue<T extends object, V extends keyof T> =
  T[V] extends object ? TreeBackedValue<T[V]> : never;

export type PropOfTreeBackedValue<T extends object, V extends keyof T> =
  PropOfBasicTreeBackedValue<T, V> | PropOfCompositeTreeBackedValue<T, V>;

export class TreeHandler<T extends object> implements ProxyHandler<T> {
  _type: CompositeType<T>;
  constructor(type: CompositeType<T>) {
    this._type = type;
  }
  type(): CompositeType<T> {
    return this._type;
  }
  backing(target: TreeBacking): TreeBacking {
    return target;
  }
  backingHandler(): this {
    return this;
  }
  backingType(): BackingType {
    return BackingType.tree;
  }
  defaultNode(): Node {
    throw new Error("Not implemented");
  }
  defaultValue(): TreeBackedValue<T> {
    return this.createBackedValue(new TreeBacking(this.defaultNode()));
  }
  createValue(value: T): TreeBackedValue<T> {
    throw new Error("Not implemented");
  }
  createBackedValue(target: TreeBacking): TreeBackedValue<T> {
    return new Proxy(target, this) as TreeBackedValue<T>;
  }
  clone(target: TreeBacking): TreeBackedValue<T> {
    return this.createBackedValue(new TreeBacking(target.node));
  }
  size(target: TreeBacking): number {
    return this._type.structural.size(this.createBackedValue(target));
  }
  equals(target: TreeBacking, other: TreeBackedValue<T>): boolean {
    if (isBackedValue(other) && other.backingType() === this.backingType()) {
      const aRoot = this.hashTreeRoot(target);
      const bRoot = this.hashTreeRoot(other.backing());
      return aRoot.every((v, i) => v === bRoot[i]);
    }
    return this._type.structural.equals(this.createBackedValue(target), other);
  }
  deserialize(data: Uint8Array): TreeBackedValue<T> {
    throw new Error("Not implemented");
  }
  serialize(target: TreeBacking): Uint8Array {
    const output = new Uint8Array(this.size(target));
    this.serializeTo(target, output, 0);
    return output;
  }
  serializeTo(target: TreeBacking, output: Uint8Array, offset: number): number {
    return this._type.structural.serializeTo(this.createBackedValue(target), output, offset);
  }
  depth(): number {
    return getDepth(BigInt(this._type.chunkCount()));
  }
  gindexOfChunk(target: TreeBacking, index: number): Gindex {
    return toGindex(BigInt(index), this.depth());
  }
  getBackingAtChunk(target: TreeBacking, index: number): TreeBacking {
    return new TreeBacking(
      target.get(this.gindexOfChunk(target, index)),
      (v: TreeBacking): void => this.setBackingAtChunk(target, index, v),
    );
  }
  setBackingAtChunk(target: TreeBacking, index: number, value: TreeBacking): void {
    target.set(this.gindexOfChunk(target, index), value.node);
  }
  getAtChunk(target: TreeBacking, index: number): PropOfTreeBackedValue<T, keyof T> {
    throw new Error("Not implemented");
  }
  setAtChunk(target: TreeBacking, index: number, value: PropOfTreeBackedValue<T, keyof T>): void {
    throw new Error("Not implemented");
  }
  chunk(target: TreeBacking, index: number): Uint8Array {
    return target.get(this.gindexOfChunk(target, index)).merkleRoot;
  }
  setChunk(target: TreeBacking, index: number, chunk: Uint8Array): void {
    target.set(this.gindexOfChunk(target, index), new LeafNode(Buffer.from(chunk)));
  }
  hashTreeRoot(target: TreeBacking): Uint8Array {
    return target.node.merkleRoot;
  }
  getMethod<V extends keyof ITreeBackedValue<T>>(target: TreeBacking, methodName: V): ITreeBackedValue<T>[V] {
    return (this as any)[methodName].bind(this, target);
  }
  getProperty(target: TreeBacking, property: keyof T): PropOfTreeBackedValue<T, keyof T> {
    throw new Error("Not implemented");
  }
  get(target: any, property: PropertyKey): PropOfTreeBackedValue<T, keyof T> | ITreeBackedValue<T>[keyof ITreeBackedValue<T>] {
    if (property in this) {
      return this.getMethod(target, property as keyof ITreeBackedValue<T>);
    } else {
      return this.getProperty(target, property as keyof T);
    }
  }
  set(target: any, property: PropertyKey, value: any): boolean {
    throw new Error("Not implemented");
  }
}
