import {TreeBacking, subtreeBackingFillToContents, zeroBacking} from "@chainsafe/merkle-tree";

import {ObjectLike} from "../../interface";
import {ContainerType, CompositeType} from "../../types";
import {TreeHandler, PropOfTreeBackedValue, TreeBackedValue} from "./abstract";
import {isBackedValue} from "..";

export class ContainerTreeHandler<T extends ObjectLike> extends TreeHandler<T> {
  protected _type: ContainerType<T>;
  constructor(type: ContainerType<T>) {
    super();
    this._type = type;
  }
  _defaultBacking: TreeBacking;
  defaultBacking(): TreeBacking {
    if (!this._defaultBacking) {
      this._defaultBacking = subtreeBackingFillToContents(
        Object.values(this._type.fields).map((fieldType) => {
          if (fieldType.isBasic()) {
            return zeroBacking(0);
          } else {
            return fieldType.tree.defaultBacking();
          }
        }),
        this.depth(),
      );
    }
    return this._defaultBacking.clone();
  }
  createValue(value: any): TreeBackedValue<T> {
    const v = this.defaultValue();
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (value[fieldName] !== null && value[fieldName] !== undefined) {
        if (fieldType.isBasic()) {
          v[fieldName as keyof T] = value[fieldName];
        } else {
          v[fieldName as keyof T] = fieldType.tree.createValue(value[fieldName]);
        }
      }
    });
    return v;
  }
  size(target: TreeBacking): number {
    let s = 0;
    Object.values(this._type.fields).forEach((fieldType, i) => {
      if (fieldType.isVariableSize()) {
        s += (fieldType as CompositeType<any>).tree.size(this.getBackingAtChunk(target, i)) + 4;
      } else {
        s += fieldType.size(null);
      }
    });
    return s;
  }
  fromBytes(data: Uint8Array, start: number, end: number): TreeBackedValue<T> {
    const target = this.defaultBacking();
    const offsets = this._type.byteArray.getVariableOffsets(
      new Uint8Array(data.buffer, data.byteOffset + start, end - start)
    );
    Object.values(this._type.fields).forEach((fieldType, i) => {
      const [currentOffset, nextOffset] = offsets[i];
      if (fieldType.isBasic()) {
        // view of the chunk, shared buffer from `data`
        const dataChunk = new Uint8Array(
          data.buffer,
          data.byteOffset + start + currentOffset,
          nextOffset - currentOffset,
        );
        const chunk = new Uint8Array(32);
        // copy chunk into new memory
        chunk.set(dataChunk);
        this.setRootAtChunk(
          target,
          i,
          chunk,
        );
      } else {
        this.setBackingAtChunk(
          target,
          i,
          fieldType.tree.fromBytes(
            data,
            start + currentOffset,
            start + nextOffset,
          ).backing(),
        );
      }
    });
    return this.createBackedValue(target);
  }
  toBytes(target: TreeBacking, output: Uint8Array, offset: number): number {
    let variableIndex = offset + Object.values(this._type.fields).reduce((total, fieldType) =>
      total + (fieldType.isVariableSize() ? 4 : fieldType.size(null)), 0);
    const fixedSection = new DataView(output.buffer, output.byteOffset + offset);
    let fixedIndex = offset;
    Object.values(this._type.fields).forEach((fieldType, i) => {
      if (fieldType.isBasic()) {
        const s = fieldType.size();
        output.set(this.getRootAtChunk(target, i).slice(0, s), fixedIndex);
        fixedIndex += s;
      } else if (fieldType.isVariableSize()) {
        // write offset
        fixedSection.setUint32(fixedIndex - offset, variableIndex - offset, true);
        fixedIndex += 4;
        // write serialized element to variable section
        variableIndex = fieldType.tree.toBytes(this.getBackingAtChunk(target, i), output, variableIndex);
      } else {
        fixedIndex = fieldType.tree.toBytes(this.getBackingAtChunk(target, i), output, fixedIndex);
      }
    });
    return variableIndex;

  }
  getProperty<V extends keyof T>(target: TreeBacking, property: V): PropOfTreeBackedValue<T, V> {
    const chunkIndex = Object.keys(this._type.fields).findIndex((fieldName) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const fieldType = this._type.fields[property as string];
    if (fieldType.isBasic()) {
      const chunk = this.getRootAtChunk(target, chunkIndex);
      return fieldType.fromBytes(chunk, 0);
    } else {
      return fieldType.tree.createBackedValue(
        this.getBackingAtChunk(target, chunkIndex)
      );
    }
  }
  set(target: TreeBacking, property: keyof T, value: T[keyof T]): boolean {
    const chunkIndex = Object.keys(this._type.fields).findIndex((fieldName) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const chunkGindex = this.gindexOfChunk(target, chunkIndex);
    const fieldType = this._type.fields[property as string];
    if (fieldType.isBasic()) {
      const chunk = new Uint8Array(32);
      fieldType.toBytes(value, chunk, 0);
      target.setRoot(chunkGindex, chunk);
      return true;
    } else {
      if (isBackedValue(value) && value.backingType() === this.backingType()) {
        target.setBacking(chunkGindex, value.backing());
        return true;
      } else {
        target.setBacking(chunkGindex, fieldType.tree.createValue(value).backing());
        return true;
      }
    }
  }
  deleteProperty(target: TreeBacking, property: keyof T): boolean {
    const chunkIndex = Object.keys(this._type.fields).findIndex((fieldName) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const fieldType = this._type.fields[property as string];
    if (fieldType.isBasic()) {
      return this.set(target, property, fieldType.defaultValue());
    } else {
      return this.set(target, property, fieldType.tree.defaultValue());
    }
  }
  ownKeys(target: TreeBacking): string[] {
    return Object.keys(this._type.fields);
  }
  getOwnPropertyDescriptor(target: TreeBacking, property: keyof T): PropertyDescriptor {
    if (this._type.fields[property as string]) {
      return {
        configurable: true,
        enumerable: true,
        writable: true,
      };
    } else {
      return undefined;
    }
  }
}
