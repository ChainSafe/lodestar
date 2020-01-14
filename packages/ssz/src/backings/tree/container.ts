import {Node, subtreeFillToContents, TreeBacking, zeroNode, LeafNode} from "@chainsafe/merkle-tree";

import {ContainerType} from "../../types";
import {TreeHandler, PropOfTreeBackedValue, TreeBackedValue} from "./abstract";
import { isBackedValue } from "..";

export class ContainerTreeHandler<T extends object> extends TreeHandler<T> {
  _type: ContainerType<T>;
  defaultNode(): Node {
    return subtreeFillToContents(
      this._type.fields.map(([_, fieldType]) => {
        if (fieldType.isBasic()) {
          return zeroNode(BigInt(0));
        } else {
          return fieldType.tree.defaultNode();
        }
      }),
      BigInt(this.depth()),
    );
  }
  createValue(value: any): TreeBackedValue<T> {
    const v = this.defaultValue();
    for (const [fieldName, fieldType] of this._type.fields) {
      if (value[fieldName] !== null && value[fieldName] !== undefined) {
        if (fieldType.isBasic()) {
          v[fieldName as keyof T] = value[fieldName];
        } else {
          v[fieldName as keyof T] = fieldType.tree.createValue(value[fieldName]);
        }
      }
    }
    return v;
  }
  size(target: TreeBacking): number {
    let s = 0;
    let i = 0;
    for (const [_, fieldType] of this._type.fields) {
      if (fieldType.isVariableSize()) {
        s += fieldType.size(this.getBackingAtChunk(target, i)) + 4;
      } else {
        s += fieldType.size(null);
      }
      i++;
    }
    return s;
  }
  serializeTo(target: TreeBacking, output: Uint8Array, offset: number): number {
    let variableIndex = offset + this._type.fields.reduce((total, [_, fieldType]) =>
      total + (fieldType.isVariableSize() ? 4 : fieldType.size(null)), 0);
    const fixedSection = new DataView(output.buffer, output.byteOffset + offset, variableIndex - offset);
    let fixedIndex = offset;
    let i = 0;
    for (const [_, fieldType] of this._type.fields) {
      if (fieldType.isBasic()) {
        const s = fieldType.size();
        output.set(this.getBackingAtChunk(target, i).node.merkleRoot.slice(0, s), fixedIndex);
        fixedIndex += s;
      } else if (fieldType.isVariableSize()) {
        // write offset
        fixedSection.setUint32(fixedIndex - offset, variableIndex, true);
        fixedIndex += 4;
        // write serialized element to variable section
        variableIndex = fieldType.serializeTo(this.getBackingAtChunk(target, i), output, variableIndex);
      } else {
        fixedIndex = fieldType.serializeTo(this.getBackingAtChunk(target, i), output, fixedIndex);
      }
      i++;
    }
    return variableIndex;

  }
  getProperty<V extends keyof T>(target: TreeBacking, property: V): PropOfTreeBackedValue<T, V> {
    const chunkIndex = this._type.fields.findIndex(([fieldName]) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const fieldType = this._type.fields[chunkIndex][1];
    if (fieldType.isBasic()) {
      const chunk = target.get(this.gindexOfChunk(target, chunkIndex)).merkleRoot;
      return fieldType.fromBytes(chunk, 0);
    } else {
      return fieldType.tree.createBackedValue(
        this.getBackingAtChunk(target, chunkIndex)
      );
    }
  }
  set(target: TreeBacking, property: keyof T, value: T[keyof T]): boolean {
    const chunkIndex = this._type.fields.findIndex(([fieldName]) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const chunkGindex = this.gindexOfChunk(target, chunkIndex);
    const fieldType = this._type.fields[chunkIndex][1];
    if (fieldType.isBasic()) {
      const chunk = new Uint8Array(32);
      fieldType.serializeTo(value, chunk, 0);
      target.set(chunkGindex, new LeafNode(Buffer.from(chunk)));
      return true;
    } else {
      if (isBackedValue(value) && value.backingType() === this.backingType()) {
        target.set(chunkGindex, value.backing().node);
        return true;
      } else {
        target.set(chunkGindex, fieldType.tree.createValue(value).backing().node);
        return true;
      }
    }
  }
  deleteProperty(target: TreeBacking, property: keyof T): boolean {
    const chunkIndex = this._type.fields.findIndex(([fieldName]) => fieldName === property);
    if (chunkIndex === -1) {
      throw new Error("Invalid container field name");
    }
    const fieldType = this._type.fields[chunkIndex][1];
    if (fieldType.isBasic()) {
      return this.set(target, property, fieldType.defaultValue());
    } else {
      return this.set(target, property, fieldType.tree.defaultValue());
    }
  }
  ownKeys(target: TreeBacking): string[] {
    return this._type.fields.map(([fieldName]) => fieldName);
  }
  getOwnPropertyDescriptor(target: TreeBacking, property: keyof T): PropertyDescriptor {
    if (this._type.fields.find(([fieldName]) => fieldName === property)) {
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
