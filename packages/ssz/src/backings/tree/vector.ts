import {TreeBacking, subtreeBackingFillToLength, zeroBacking} from "@chainsafe/merkle-tree";

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
  _defaultBacking: TreeBacking;
  defaultBacking(): TreeBacking {
    if (!this._defaultBacking) {
      this._defaultBacking = subtreeBackingFillToLength(
        zeroBacking(0),
        this.depth(),
        this._type.chunkCount()
      );
    }
    return this._defaultBacking.clone();
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
  setProperty(target: TreeBacking, property: number, value: T[number]): boolean {
    if (property >= this.getLength(target)) {
      throw new Error("Invalid array index");
    }
    return super.setProperty(target, property, value, false);
  }
}

export class CompositeVectorTreeHandler<T extends Vector<any>> extends CompositeArrayTreeHandler<T> {
  _type: CompositeVectorType<T>;
  constructor(type: CompositeVectorType<T>) {
    super();
    this._type = type;
  }
  _defaultBacking: TreeBacking;
  defaultBacking(): TreeBacking {
    if (!this._defaultBacking) {
      this._defaultBacking = subtreeBackingFillToLength(
        this._type.elementType.tree.defaultBacking(),
        this.depth(),
        this._type.length
      );
    }
    return this._defaultBacking.clone();
  }
  getLength(target: TreeBacking): number {
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
        this.setBackingAtChunk(
          target,
          i,
          this._type.elementType.fromBytes(
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
        this.setBackingAtChunk(
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
  setProperty(target: TreeBacking, property: number, value: T[number]): boolean {
    if (property >= this.getLength(target)) {
      throw new Error("Invalid array index");
    }
    return super.setProperty(target, property, value, false);
  }
}
