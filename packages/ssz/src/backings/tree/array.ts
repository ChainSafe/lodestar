/* eslint-disable @typescript-eslint/no-unused-vars */
import {Tree, iterateAtDepth, Gindex} from "@chainsafe/persistent-merkle-tree";

import {ArrayLike} from "../../interface";
import {BasicArrayType, CompositeArrayType} from "../../types";
import {isTreeBacked, TreeHandler, PropOfCompositeTreeBacked} from "./abstract";

export class BasicArrayTreeHandler<T extends ArrayLike<unknown>> extends TreeHandler<T> {
  protected _type: BasicArrayType<T>;
  fromStructural(value: T): Tree {
    const  v = this.defaultValue();
    for (let i = 0; i < value.length; i++) {
      (v as ArrayLike<unknown>)[i as number] = value[i];
    }
    return v.tree();
  }
  size(target: Tree): number {
    return this._type.elementType.size() * this.getLength(target);
  }
  fromBytes(data: Uint8Array, start: number, end: number): Tree {
    const target = this.defaultBacking();
    const byteLength = (end - start);
    const chunkCount = Math.ceil(byteLength / 32);
    for (let i = 0; i < chunkCount; i++) {
      // view of the chunk, shared buffer from `data`
      const dataChunk = new Uint8Array(
        data.buffer,
        data.byteOffset + start + (i * 32),
        Math.min(32, byteLength - (i * 32))
      );
      // copy chunk into new memory
      const chunk = new Uint8Array(32);
      chunk.set(dataChunk);
      this.setRootAtChunk(
        target,
        i,
        chunk,
        true, // expand tree as needed
      );
    }
    return target;
  }
  toBytes(target: Tree, output: Uint8Array, offset: number): number {
    const size = this.size(target);
    let i = 0;
    let chunkIndex = 0;
    for (; i < size - 31; i+=32, chunkIndex += 1) {
      output.set(this.getRootAtChunk(target, chunkIndex), offset + i);
    }
    if (i !== size) {
      output.set(this.getRootAtChunk(target, chunkIndex).slice(0, (size - i)), offset + i);
    }
    return offset + size;
  }
  gindexOfProperty(target: Tree, prop: PropertyKey): Gindex {
    return this.gindexOfChunk(target, this.getChunkIndex(prop as number));
  }
  getLength(target: Tree): number {
    throw new Error("Not implemented");
  }
  getChunkOffset(index: number): number {
    const elementSize = this._type.elementType.size();
    return (index % Math.ceil(32 / elementSize)) * elementSize;
  }
  getChunkIndex(index: number): number {
    return Math.floor(index / Math.ceil(32 / this._type.elementType.size()));
  }
  getValueAtIndex(target: Tree, index: number): T[number] {
    const chunk = this.getRootAtChunk(target, this.getChunkIndex(index));
    return this._type.elementType.fromBytes(chunk, this.getChunkOffset(index));
  }
  getProperty(target: Tree, property: keyof T): T[keyof T] {
    const length = this.getLength(target);
    if (property === "length") {
      return length as T[keyof T];
    }
    const index = Number(property);
    if (Number.isNaN(index as number)) {
      return undefined;
    }
    if (index >= length) {
      return undefined;
    }
    return this.getValueAtIndex(target, index);
  }
  setProperty(target: Tree, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, this.getChunkIndex(property));
    // copy data from old chunk, use new memory to set a new chunk
    const dataChunk = target.getRoot(chunkGindex);
    const chunk = new Uint8Array(32);
    chunk.set(dataChunk);
    this._type.elementType.toBytes(value, chunk, this.getChunkOffset(property));
    target.setRoot(chunkGindex, chunk, expand);
    return true;
  }
  set(target: Tree, property: number, value: T[number], expand=false): boolean {
    return this.setProperty(target, property, value, expand);
  }
  deleteProperty(target: Tree, property: number): boolean {
    return this.setProperty(target, property, this._type.elementType.defaultValue());
  }
  ownKeys(target: Tree): string[] {
    return Array.from({length: this.getLength(target)}, (_, i) => String(i));
  }
  *[Symbol.iterator](target: Tree): Iterable<T[number]> {
    for (let i = 0; i < this.getLength(target); i++) {
      yield this.getValueAtIndex(target, i);
    }
  }
  find(
    target: Tree,
    fn: (value: T[keyof T], index: number, array: ArrayLike<unknown>) => boolean
  ): T[keyof T] | undefined {
    const value = this.asTreeBacked(target);
    for (let i = 0; i < this.getLength(target); i++) {
      const elementValue = this.getValueAtIndex(target, i);
      if (fn(elementValue, i, value)) {
        return elementValue;
      }
    }
    return undefined;
  }
  findIndex(
    target: Tree,
    fn: (value: T[keyof T], index: number, array: ArrayLike<unknown>) => boolean
  ): number {
    const value = this.asTreeBacked(target);
    for (let i = 0; i < this.getLength(target); i++) {
      if (fn(this.getValueAtIndex(target, i), i, value)) {
        return i;
      }
    }
    return -1;
  }
  forEach(target: Tree, fn: (value: T[keyof T], index: number, array: ArrayLike<unknown>) => void): void {
    const value = this.asTreeBacked(target);
    for (let i = 0; i < this.getLength(target); i++) {
      fn(this.getValueAtIndex(target, i), i, value);
    }
  }
}

export class CompositeArrayTreeHandler<T extends ArrayLike<object>> extends TreeHandler<T> {
  protected _type: CompositeArrayType<T>;
  fromStructural(value: T): Tree {
    const  v = this.defaultValue();
    for (let i = 0; i < value.length; i++) {
      (v as ArrayLike<object>)[i as number] = value[i];
    }
    return v.tree();
  }
  size(target: Tree): number {
    if (this._type.elementType.isVariableSize()) {
      let s = 0;
      for (let i = 0; i < this.getLength(target); i++) {
        s += this._type.elementType.tree.size(this.getSubtreeAtChunk(target, i)) + 4;
      }
      return s;
    } else {
      return this._type.elementType.tree.size(null) * this.getLength(target);
    }
  }
  toBytes(target: Tree, output: Uint8Array, offset: number): number {
    const length = this.getLength(target);
    if (this._type.elementType.isVariableSize()) {
      let variableIndex = offset + (length * 4);
      const fixedSection = new DataView(output.buffer, output.byteOffset + offset, length * 4);
      for (let i = 0; i < length; i++) {
        // write offset
        fixedSection.setUint32(i * 4, variableIndex - offset, true);
        // write serialized element to variable section
        variableIndex = this._type.elementType.tree.toBytes(
          this.getSubtreeAtChunk(target, i),
          output,
          variableIndex
        );
      }
      return variableIndex;
    } else {
      let index = offset;
      for (let i = 0; i < length; i++) {
        index = this._type.elementType.tree.toBytes(
          this.getSubtreeAtChunk(target, i),
          output,
          index
        );
      }
      return index;
    }
  }
  gindexOfProperty(target: Tree, prop: PropertyKey): Gindex {
    return this.gindexOfChunk(target, prop as number);
  }
  getLength(target: Tree): number {
    throw new Error("Not implemented");
  }
  getValueAtChunk(target: Tree, index: number): PropOfCompositeTreeBacked<T, number> {
    return this._type.elementType.tree.asTreeBacked(
      this.getSubtreeAtChunk(target, index)
    ) as PropOfCompositeTreeBacked<T, number>;
  }
  getProperty<V extends keyof T>(target: Tree, property: V): PropOfCompositeTreeBacked<T, V> {
    const length = this.getLength(target);
    if (property === "length") {
      return length as unknown as PropOfCompositeTreeBacked<T, V>;
    }
    const index = Number(property);
    if (Number.isNaN(index as number)) {
      return undefined;
    }
    if (index >= length) {
      return undefined;
    }
    return this.getValueAtChunk(target, index) as unknown as PropOfCompositeTreeBacked<T, V>;
  }
  setProperty(target: Tree, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, property);
    if (isTreeBacked(value)) {
      target.setSubtree(chunkGindex, value.tree());
    } else {
      target.setSubtree(chunkGindex, this._type.elementType.tree.fromStructural(value), expand);
    }
    return true;
  }
  set(target: Tree, property: number, value: T[number], expand=false): boolean {
    return this.setProperty(target, property, value, expand);
  }
  deleteProperty(target: Tree, property: number): boolean {
    return this.setProperty(target, property, this._type.elementType.tree.defaultValue());
  }
  ownKeys(target: Tree): string[] {
    return Array.from({length: this.getLength(target)}, (_, i) => String(i));
  }
  *[Symbol.iterator](target: Tree): Iterable<PropOfCompositeTreeBacked<T, number>> {
    const elementTreeHandler = this._type.elementType.tree;
    for (const gindex of iterateAtDepth(BigInt(0), BigInt(this.getLength(target)), this.depth())) {
      yield elementTreeHandler.asTreeBacked(
        target.getSubtree(gindex)
      ) as PropOfCompositeTreeBacked<T, number>;
    }
  }
  find(
    target: Tree,
    fn: (value: PropOfCompositeTreeBacked<T, number>, index: number, array: ArrayLike<unknown>) => boolean
  ): PropOfCompositeTreeBacked<T, number> | undefined {
    const value = this.asTreeBacked(target);
    const elementTreeHandler = this._type.elementType.tree;
    let i = 0;
    for (const gindex of iterateAtDepth(BigInt(0), BigInt(this.getLength(target)), this.depth())) {
      const elementValue = elementTreeHandler.asTreeBacked(
        target.getSubtree(gindex)
      ) as PropOfCompositeTreeBacked<T, number>;
      if (fn(elementValue, i, value)) {
        return elementValue;
      }
      i++;
    }
    return undefined;
  }
  findIndex(
    target: Tree,
    fn: (value: PropOfCompositeTreeBacked<T, number>, index: number, array: ArrayLike<unknown>) => boolean
  ): number {
    const value = this.asTreeBacked(target);
    const elementTreeHandler = this._type.elementType.tree;
    let i = 0;
    for (const gindex of iterateAtDepth(BigInt(0), BigInt(this.getLength(target)), this.depth())) {
      const elementValue = elementTreeHandler.asTreeBacked(
        target.getSubtree(gindex)
      ) as PropOfCompositeTreeBacked<T, number>;
      if (fn(elementValue, i, value)) {
        return i;
      }
      i++;
    }
    return -1;
  }
  forEach(target: Tree, fn: (value: unknown, index: number, array: ArrayLike<object>) => void): void {
    const value = this.asTreeBacked(target);
    const elementTreeHandler = this._type.elementType.tree;
    let i = 0;
    for (const gindex of iterateAtDepth(BigInt(0), BigInt(this.getLength(target)), this.depth())) {
      const elementValue = elementTreeHandler.asTreeBacked(
        target.getSubtree(gindex)
      ) as PropOfCompositeTreeBacked<T, number>;
      fn(elementValue, i, value);
      i++;
    }
  }
}
