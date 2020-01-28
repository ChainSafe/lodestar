import {ObjectLike} from "../../interface";
import {ContainerType, CompositeType, Type} from "../../types";
import {StructuralHandler} from "./abstract";

export class ContainerStructuralHandler<T extends ObjectLike> extends StructuralHandler<T> {
  _type: ContainerType<T>;
  constructor(type: ContainerType<T>) {
    super();
    this._type = type;
  }
  defaultValue(): T {
    const obj = {} as T;
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (fieldType.isBasic()) {
        obj[fieldName as keyof T] = fieldType.defaultValue();
      } else {
        obj[fieldName as keyof T] = fieldType.structural.defaultValue();
      }
    });
    return obj;
  }
  size(value: T): number {
    let s = 0;
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (fieldType.isVariableSize()) {
        s += fieldType.size(value[fieldName]) + 4;
      } else {
        s += fieldType.size(null);
      }
    });
    return s;
  }
  assertValidValue(value: any): asserts value is T {
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (fieldType.isBasic()) {
        (fieldType as Type<any>).assertValidValue(value[fieldName]);
      } else {
        fieldType.structural.assertValidValue(value[fieldName]);
      }
    });
  }
  equals(value1: T, value2: T): boolean {
    this.assertValidValue(value1);
    this.assertValidValue(value2);
    return Object.entries(this._type.fields).every(([fieldName, fieldType]) => {
      if (fieldType.isBasic()) {
        return fieldType.equals(value1[fieldName], value2[fieldName]);
      } else {
        return fieldType.structural.equals(value1[fieldName], value2[fieldName]);
      }
    });
  }
  clone(value: T): T {
    const newValue = {} as T;
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (fieldType.isBasic()) {
        newValue[fieldName as keyof T] = fieldType.clone(value[fieldName]);
      } else {
        newValue[fieldName as keyof T] = fieldType.structural.clone(value[fieldName]);
      }
    });
    return newValue;
  }
  fromBytes(data: Uint8Array, start: number, end: number): T {
    let currentIndex = start;
    let nextIndex = currentIndex;
    const value = {} as T;
    // Since variable-sized values can be interspersed with fixed-sized values, we precalculate
    // the offset indices so we can more easily deserialize the fields in once pass
    // first we get the fixed sizes
    const fixedSizes: (number | false)[] = Object.values(this._type.fields)
      .map((fieldType) => !fieldType.isVariableSize() && fieldType.size(null));
    // with the fixed sizes, we can read the offsets, and store for our single pass
    const offsets: number[] = [];
    const fixedSection = new DataView(data.buffer, data.byteOffset);
    const fixedEnd = fixedSizes.reduce((index: number, size) => {
      if (size === false) {
        offsets.push(start + fixedSection.getUint32(index, true));
        return index + 4;
      } else {
        return index + size;
      }
    }, start);
    offsets.push(end);
    if (fixedEnd !== offsets[0]) {
      throw new Error("Not all variable bytes consumed");
    }
    let offsetIndex = 0;
    Object.entries(this._type.fields).forEach(([fieldName, fieldType], i) => {
      const fieldSize = fixedSizes[i];
      if (fieldSize === false) { // variable-sized field
        if (offsets[offsetIndex] > end) {
          throw new Error("Offset out of bounds");
        }
        if (offsets[offsetIndex] > offsets[offsetIndex + 1]) {
          throw new Error("Offsets must be increasing");
        }
        value[fieldName as keyof T] = (fieldType as CompositeType<any>).structural.fromBytes(
          data, offsets[offsetIndex], offsets[offsetIndex + 1],
        );
        offsetIndex++;
        currentIndex += 4;
      } else { // fixed-sized field
        nextIndex = currentIndex + fieldSize;
        if (fieldType.isBasic()) {
          value[fieldName as keyof T] = fieldType.fromBytes(data, currentIndex);
        } else {
          value[fieldName as keyof T] = fieldType.structural.fromBytes(data, currentIndex, nextIndex);
        }
        currentIndex = nextIndex;
      }
    });
    if (offsets.length > 1) {
      if (offsetIndex !== offsets.length - 1) {
        throw new Error("Not all variable bytes consumed");
      }
      if (currentIndex !== offsets[0]) {
        throw new Error("Not all fixed bytes consumed");
      }
    } else {
      if (currentIndex !== end) {
        throw new Error("Not all fixed bytes consumed");
      }
    }
    return value;
  }
  toBytes(value: T, output: Uint8Array, offset: number): number {
    let variableIndex = offset + Object.values(this._type.fields).reduce((total, fieldType) =>
      total + (fieldType.isVariableSize() ? 4 : fieldType.size(null)), 0);
    const fixedSection = new DataView(output.buffer, output.byteOffset + offset);
    let fixedIndex = offset;
    Object.entries(this._type.fields).forEach(([fieldName, fieldType]) => {
      if (fieldType.isVariableSize()) {
        // write offset
        fixedSection.setUint32(fixedIndex - offset, variableIndex - offset, true);
        fixedIndex += 4;
        // write serialized element to variable section
        variableIndex = fieldType.toBytes(value[fieldName], output, variableIndex);
      } else {
        fixedIndex = fieldType.toBytes(value[fieldName], output, fixedIndex);
      }
    });
    return variableIndex;
  }
  chunk(value: T, index: number): Uint8Array {
    const fieldName = Object.keys(this._type.fields)[index];
    const fieldType = this._type.fields[fieldName];
    return fieldType.hashTreeRoot(value[fieldName]);
  }
}
