import {TreeBacking} from "@chainsafe/merkle-tree";

import {ArrayLike} from "../../interface";
import {BasicArrayType, CompositeArrayType} from "../../types";
import {TreeHandler, PropOfCompositeTreeBackedValue, TreeBackedValue} from "./abstract";
import { isBackedValue} from "..";

export class BasicArrayTreeHandler<T extends ArrayLike<any>> extends TreeHandler<T> {
  protected _type: BasicArrayType<T>;
  createValue(value: any): TreeBackedValue<T> {
    const  v = this.defaultValue();
    for (let i = 0; i < value.length; i++) {
      v[i] = value[i];
    }
    return v;
  }
  size(target: TreeBacking): number {
    return this._type.elementType.size() * this.getLength(target);
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const target = new TreeBacking(this.defaultNode());
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
      target.setRoot(
        this.gindexOfChunk(target, i),
        chunk,
        true, // expand tree as needed
      );
    }
    return this.createBackedValue(target);
  }
  toBytes(target: TreeBacking, output: Uint8Array, offset: number): number {
    const size = this.size(target);
    let i = 0;
    let chunkIndex = 0;
    for (; i < size - 31; i+=32, chunkIndex += 1) {
      output.set(target.getRoot(this.gindexOfChunk(target, chunkIndex)), offset + i);
    }
    if (i !== size) {
      output.set(target.getRoot(this.gindexOfChunk(target, chunkIndex)).slice(0, (size - i)), offset + i);
    }
    return offset + size;
  }
  getLength(target: TreeBacking): number {
    throw new Error("Not implemented");
  }
  getChunkOffset(index: number): number {
    const elementSize = this._type.elementType.size();
    return (index % Math.ceil(32 / elementSize)) * elementSize;
  }
  getChunkIndex(index: number): number {
    return Math.floor(index / Math.ceil(32 / this._type.elementType.size()));
  }
  getValueAtIndex(target: TreeBacking, index: number): T[number] {
    const chunk = target.getRoot(this.gindexOfChunk(target, this.getChunkIndex(index)));
    return this._type.elementType.fromBytes(chunk, this.getChunkOffset(index));
  }
  getProperty(target: TreeBacking, property: keyof T): T[keyof T] {
    const length = this.getLength(target);
    if (property === "length") {
      return length as T[keyof T];
    }
    property = Number(property);
    if (Number.isNaN(property as number)) {
      throw new Error("Array index must be a number");
    }
    if (property >= length) {
      throw new Error("Invalid array index");
    }
    return this.getValueAtIndex(target, property as number);
  }
  setProperty(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, this.getChunkIndex(property));
    const chunk = target.getRoot(chunkGindex);
    this._type.elementType.toBytes(value, chunk, this.getChunkOffset(property));
    target.setRoot(chunkGindex, chunk, expand);
    return true;
  }
  set(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    return this.setProperty(target, property, value, expand);
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    return this.setProperty(target, property, this._type.elementType.defaultValue());
  }
  ownKeys(target: TreeBacking): string[] {
    return Array.from({length: this.getLength(target)}, (_, i) => String(i));
  }
  *[Symbol.iterator](target: TreeBacking): Iterable<T[number]> {
    for (let i = 0; i < this.getLength(target); i++) {
      yield this.getValueAtIndex(target, i);
    }
  }
}

export class CompositeArrayTreeHandler<T extends ArrayLike<any>> extends TreeHandler<T> {
  protected _type: CompositeArrayType<T>;
  createValue(value: any): TreeBackedValue<T> {
    const  v = this.defaultValue();
    for (let i = 0; i < value.length; i++) {
      v[i] = value[i];
    }
    return v;
  }
  size(target: TreeBacking): number {
    if (this._type.elementType.isVariableSize()) {
      let s = 0;
      for (let i = 0; i < this.getLength(target); i++) {
        s += this._type.elementType.tree.size(this.getBackingAtChunk(target, i)) + 4;
      }
      return s;
    } else {
      return this._type.elementType.tree.size(null) * this.getLength(target);
    }
  }
  toBytes(target: TreeBacking, output: Uint8Array, offset: number): number {
    const length = this.getLength(target);
    if (this._type.elementType.isVariableSize()) {
      let variableIndex = offset + (length * 4);
      const fixedSection = new DataView(output.buffer, output.byteOffset + offset, length * 4);
      for (let i = 0; i < length; i++) {
        // write offset
        fixedSection.setUint32(i * 4, variableIndex - offset, true);
        // write serialized element to variable section
        variableIndex = this._type.elementType.tree.toBytes(
          this.getBackingAtChunk(target, i),
          output,
          variableIndex
        );
      }
      return variableIndex;
    } else {
      let index = offset;
      for (let i = 0; i < length; i++) {
        index = this._type.elementType.tree.toBytes(
          this.getBackingAtChunk(target, i),
          output,
          index
        );
      }
      return index;
    }
  }
  getLength(target: TreeBacking): number {
    throw new Error("Not implemented");
  }
  getValueAtChunk(target: TreeBacking, index: number): PropOfCompositeTreeBackedValue<T, number> {
    return this._type.elementType.tree.createBackedValue(
      this.getBackingAtChunk(target, index)
    );
  }
  getProperty<V extends keyof T>(target: TreeBacking, property: V): PropOfCompositeTreeBackedValue<T, V> {
    const length = this.getLength(target);
    if (property === "length") {
      return length as PropOfCompositeTreeBackedValue<T, V>;
    }
    property = Number(property) as any;
    if (property > length) {
      throw new Error("Invalid array index");
    }
    return this.getValueAtChunk(target, property as number);
  }
  setProperty(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, property);
    if (isBackedValue(value) && value.backingType() === this.backingType()) {
      target.set(chunkGindex, (value.backing() as TreeBacking).node);
      return true;
    } else {
      target.set(chunkGindex, this._type.elementType.tree.createValue(value).backing().node, expand);
      return true;
    }
  }
  set(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    return this.setProperty(target, property, value, expand);
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    return this.setProperty(target, property, this._type.elementType.tree.defaultValue());
  }
  ownKeys(target: TreeBacking): string[] {
    return Array.from({length: this.getLength(target)}, (_, i) => String(i));
  }
  *[Symbol.iterator](target: TreeBacking): Iterable<PropOfCompositeTreeBackedValue<T, number>> {
    for (let i = 0; i < this.getLength(target); i++) {
      yield this.getValueAtChunk(target, i);
    }
  }
}
