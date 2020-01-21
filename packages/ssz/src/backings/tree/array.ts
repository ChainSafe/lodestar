import {Node, BranchNode, zeroNode, TreeBacking, LeafNode} from "@chainsafe/merkle-tree";

import {ArrayLike} from "../../interface";
import {BasicArrayType, CompositeArrayType} from "../../types";
import {TreeHandler, PropOfCompositeTreeBackedValue, TreeBackedValue} from "./abstract";
import { isBackedValue} from "..";

export class BasicArrayTreeHandler<T extends ArrayLike<any>> extends TreeHandler<T> {
  _type: BasicArrayType<T>;
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
  serializeTo(target: TreeBacking, output: Uint8Array, offset: number): number {
    const size = this.size(target);
    let i = 0;
    let chunkIndex = 0;
    for (; i < size - 31; i+=32, chunkIndex += 1) {
      output.set(target.get(this.gindexOfChunk(target, chunkIndex)).merkleRoot, offset + i);
    }
    if (i !== size) {
      output.set(target.get(this.gindexOfChunk(target, chunkIndex)).merkleRoot.slice(0, (size - i)), offset + i);
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
    const chunk = target.get(this.gindexOfChunk(target, this.getChunkIndex(index))).merkleRoot;
    return this._type.elementType.fromBytes(chunk, this.getChunkOffset(index));
  }
  getProperty(target: TreeBacking, property: keyof T): T[keyof T] {
    const length = this.getLength(target);
    if (property === "length") {
      return length as T[keyof T];
    }
    property = Number(property);
    if (property > length) {
      throw new Error("Invalid array index");
    }
    return this.getValueAtIndex(target, property as number);
  }
  set(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, this.getChunkIndex(property));
    const chunk = Uint8Array.from(
      target.get(chunkGindex).merkleRoot
    );
    this._type.elementType.serializeTo(value, chunk, this.getChunkOffset(property));
    target.set(chunkGindex, new LeafNode(Buffer.from(chunk)), expand);
    return true;
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    return this.set(target, property, this._type.elementType.defaultValue());
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
  _type: CompositeArrayType<T>;
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
  serializeTo(target: TreeBacking, output: Uint8Array, offset: number): number {
    const length = this.getLength(target);
    if (this._type.elementType.isVariableSize()) {
      let variableIndex = offset + length + 4;
      const fixedSection = new DataView(output.buffer, output.byteOffset + offset, length * 4);
      for (let i = 0; i < length; i++) {
        // write offset
        fixedSection.setUint32(i, variableIndex - offset, true);
        // write serialized element to variable section
        variableIndex = this._type.elementType.tree.serializeTo(
          this.getBackingAtChunk(target, i),
          output,
          variableIndex
        );
      }
      return variableIndex;
    } else {
      let index = offset;
      for (let i = 0; i < length; i++) {
        index = this._type.elementType.tree.serializeTo(
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
  set(target: TreeBacking, property: number, value: T[number], expand=false): boolean {
    const chunkGindex = this.gindexOfChunk(target, property);
    if (isBackedValue(value) && value.backingType() === this.backingType()) {
      target.set(chunkGindex, value.backing().node);
      return true;
    } else {
      target.set(chunkGindex, this._type.elementType.tree.createValue(value).backing().node, expand);
      return true;
    }
  }
  deleteProperty(target: TreeBacking, property: number): boolean {
    return this.set(target, property, this._type.elementType.tree.defaultValue());
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
