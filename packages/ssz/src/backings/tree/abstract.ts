import {Node, Tree, Gindex, countToDepth, toGindex} from "@chainsafe/merkle-tree";

import {CompositeType} from "../../types";
import {isBackedValue, BackingType} from "..";

/**
 * The ITreeBackedValue interface represents the public API that attach to tree-backed Proxy objects
 *
 * This is an alternative way of calling methods of the attached TreeHandler
 */
export interface ITreeBackedValue<T extends object> {
  type(): CompositeType<T>;

  /**
   * Equality
   *
   * If both values are tree-backed, use equality by merkle root, else use structural equality
   */
  equals(other: T): boolean;
  /**
   * Clone / Copy
   */
  clone(): TreeBackedValue<T>;

  /**
   * Serialized byte length
   */
  size(): number;
  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(output: Uint8Array, offset: number): number;
  /**
   * Serialization
   */
  serialize(): Uint8Array;

  /**
   * The depth of the merkle tree
   */
  depth(): number;
  /**
   * The gindex of a property
   */
  gindexOfProperty(prop: PropertyKey): Gindex;
  /**
   * Merkleization
   */
  hashTreeRoot(): Uint8Array;

  // Backing

  /**
   * The merkle tree backing
   */
  backing(): Tree;
  /**
   * The attached TreeHandler
   */
  backingHandler(): TreeHandler<T>;
  /**
   * The BackingType associated with the merkle tree backing
   */
  backingType(): BackingType;
}

/**
 * Since tree-backed values return tree-backed-values from non-basic-type property getters,
 * we need this type to recursively wrap subobjects (non-basic values) as tree-backed values.
 */
export type TreeBackedValueify<T> = {
  [P in keyof T]: T[P] extends object ? TreeBackedValue<T[P]> : T[P];
};

/**
 * A tree-backed value has the ITreeBackedValue public API as well as tree-backed getters/setters
 */
export type TreeBackedValue<T extends object> = ITreeBackedValue<T> & TreeBackedValueify<T> & T;

/**
 * Every property of a 'basic' tree-backed value is of a basic type, ie not a tree-backed value
 */
export type PropOfBasicTreeBackedValue<T extends object, V extends keyof T> = T[V];

/**
 * Every property of a 'composite' tree-backed value is of a composite type, ie a tree-backed value
 */
export type PropOfCompositeTreeBackedValue<T extends object, V extends keyof T> =
  T[V] extends object ? TreeBackedValue<T[V]> : never;

export type PropOfTreeBackedValue<T extends object, V extends keyof T> =
  PropOfBasicTreeBackedValue<T, V> | PropOfCompositeTreeBackedValue<T, V>;

/**
 * A TreeHandler instance handles tree-backed-specific logic.
 * It is a property of its associated CompositeType, and vice-versa.
 * It is also attached to each TreeBackedValue as its ES6 Proxy handler
 *
 * These methods can be used in both contexts (when part of ITreeBackedValue):
 * eg:
 *   Type.tree.hashTreeRoot(tree)
 *   and
 *   treeBackedValue.hashTreeRoot()
 */
export class TreeHandler<T extends object> implements ProxyHandler<T> {
  protected _type: CompositeType<T>;
  type(): CompositeType<T> {
    return this._type;
  }
  /**
   * The merkle tree backing
   */
  backing(target: Tree): Tree {
    return target;
  }
  /**
   * The attached TreeHandler
   */
  backingHandler(): this {
    return this;
  }
  /**
   * The BackingType associated with the merkle tree backing
   */
  backingType(): BackingType {
    return BackingType.tree;
  }

  defaultNode(): Node {
    throw new Error("Not implemented");
  }
  /**
   * Default merkle tree backing
   */
  defaultBacking(): Tree {
    throw new Error("Not implemented");
  }
  /**
   * Default constructor
   */
  defaultValue(): TreeBackedValue<T> {
    return this.createBackedValue(this.defaultBacking());
  }
  createValue(value: T): TreeBackedValue<T> {
    throw new Error("Not implemented");
  }
  /**
   * Return an ES6 Proxy-wrapped tree backing
   */
  createBackedValue(target: Tree): TreeBackedValue<T> {
    return new Proxy(target, this) as TreeBackedValue<T>;
  }
  /**
   * Clone / copy
   */
  clone(target: Tree): TreeBackedValue<T> {
    return this.createBackedValue(target.clone());
  }
  /**
   * Equality
   *
   * If both values are tree-backed, use equality by merkle root, else use structural equality
   */
  equals(target: Tree, other: TreeBackedValue<T>): boolean {
    if (isBackedValue(other) && other.backingType() === this.backingType()) {
      const aRoot = this.hashTreeRoot(target);
      const bRoot = this.hashTreeRoot(other.backing());
      return aRoot.every((v, i) => v === bRoot[i]);
    }
    return this._type.structural.equals(this.createBackedValue(target), other);
  }

  // Serialization

  /**
   * Serialized byte length
   */
  size(target: Tree): number {
    return this._type.structural.size(this.createBackedValue(target));
  }
  /**
   * Low-level deserialization
   */
  fromBytes(data: Uint8Array, start: number, end: number): Tree {
    throw new Error("Not implemented");
  }
  /**
   * Deserialization
   */
  deserialize(data: Uint8Array): TreeBackedValue<T> {
    return this.createBackedValue(this.fromBytes(data, 0, data.length));
  }
  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(target: Tree, output: Uint8Array, offset: number): number {
    return this._type.structural.toBytes(this.createBackedValue(target), output, offset);
  }
  /**
   * Serialization
   */
  serialize(target: Tree): Uint8Array {
    const output = new Uint8Array(this.size(target));
    this.toBytes(target, output, 0);
    return output;
  }
  protected _depth: number;

  // Merkleization

  gindexOfProperty(target: Tree, prop: PropertyKey): Gindex {
    throw new Error("Not implemented");
  }
  /**
   * The depth of the merkle tree
   */
  depth(): number {
    if (!this._depth) {
      this._depth = countToDepth(BigInt(this._type.chunkCount()));
    }
    return this._depth;
  }
  gindexOfChunk(target: Tree, index: number): Gindex {
    return toGindex(BigInt(index), this.depth());
  }
  getSubtreeAtChunk(target: Tree, index: number): Tree {
    return target.getSubtree(this.gindexOfChunk(target, index));
  }
  setSubtreeAtChunk(target: Tree, index: number, value: Tree, expand=false): void {
    target.setSubtree(this.gindexOfChunk(target, index), value, expand);
  }
  getRootAtChunk(target: Tree, index: number): Uint8Array {
    return target.getRoot(this.gindexOfChunk(target, index));
  }
  setRootAtChunk(target: Tree, index: number, value: Uint8Array, expand=false): void {
    target.setRoot(this.gindexOfChunk(target, index), value, expand);
  }
  /**
   * Merkleization
   */
  hashTreeRoot(target: Tree): Uint8Array {
    return target.root;
  }

  /**
   * Return a ITreeBackedValue method, to be called using the ITreeBackedValue interface
   */
  protected getMethod<V extends keyof ITreeBackedValue<T>>(target: Tree, methodName: V): ITreeBackedValue<T>[V] {
    return (this as any)[methodName].bind(this, target);
  }
  /**
   * Return a property of T, either a subtree TreeBackedValue or a primitive, of a basic type
   */
  getProperty(target: Tree, property: keyof T): PropOfTreeBackedValue<T, keyof T> {
    throw new Error("Not implemented");
  }
  /**
   * ES6 Proxy trap to get a ITreeBackedValue method or property of T
   */
  get(target: any, property: PropertyKey): PropOfTreeBackedValue<T, keyof T> | ITreeBackedValue<T>[keyof ITreeBackedValue<T>] {
    if (property in this) {
      return this.getMethod(target, property as keyof ITreeBackedValue<T>);
    } else {
      return this.getProperty(target, property as keyof T);
    }
  }
  /**
   * ES6 Proxy trap to set a property of T
   */
  set(target: any, property: PropertyKey, value: unknown): boolean {
    throw new Error("Not implemented");
  }
}
