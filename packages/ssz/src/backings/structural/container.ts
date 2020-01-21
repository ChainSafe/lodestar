import {ObjectLike} from "../../interface";
import {ContainerType} from "../../types";
import {StructuralHandler} from "./abstract";

export class ContainerStructuralHandler<T extends ObjectLike> extends StructuralHandler<T> {
  _type: ContainerType<T>;
  defaultValue(): T {
    const obj = {} as T;
    for (const [fieldName, fieldType] of this._type.fields) {
      if (fieldType.isBasic()) {
        obj[fieldName as keyof T] = fieldType.defaultValue();
      } else {
        obj[fieldName as keyof T] = fieldType.structural.defaultValue();
      }
    }
    return obj;
  }
  size(value: T): number {
    let s = 0;
    for (const [fieldName, fieldType] of this._type.fields) {
      if (fieldType.isVariableSize()) {
        s += fieldType.size(value[fieldName]) + 4;
      } else {
        s += fieldType.size(null);
      }
    }
    return s;
  }
  assertValidValue(value: any): void {
    for (const [fieldName, fieldType] of this._type.fields) {
      if (fieldType.isBasic()) {
        fieldType.assertValidValue(value[fieldName]);
      } else {
        fieldType.structural.assertValidValue(value[fieldName]);
      }
    }
  }
  equals(value1: T, value2: T): boolean {
    this.assertValidValue(value1);
    this.assertValidValue(value2);
    return this._type.fields.every(([fieldName, fieldType]) => {
      if (fieldType.isBasic()) {
        return fieldType.equals(value1[fieldName], value2[fieldName]);
      } else {
        return fieldType.structural.equals(value1[fieldName], value2[fieldName]);
      }
    });
  }
  clone(value: T): T {
    const newValue = {} as T;
    for (const [fieldName, fieldType] of this._type.fields) {
      if (fieldType.isBasic()) {
        newValue[fieldName as keyof T] = fieldType.clone(value[fieldName]);
      } else {
        newValue[fieldName as keyof T] = fieldType.structural.clone(value[fieldName]);
      }
    }
    return newValue;
  }
  serializeTo(value: T, output: Uint8Array, offset: number): number {
    let variableIndex = offset + this._type.fields.reduce((total, [fieldName, fieldType]) =>
      total + (fieldType.isVariableSize() ? 4 : fieldType.size(null)), 0);
    const fixedSection = new DataView(output.buffer, output.byteOffset + offset, variableIndex - offset);
    let fixedIndex = offset;
    for (const [fieldName, fieldType] of this._type.fields) {
      if (fieldType.isVariableSize()) {
        // write offset
        fixedSection.setUint32(fixedIndex - offset, variableIndex, true);
        fixedIndex += 4;
        // write serialized element to variable section
        variableIndex = fieldType.serializeTo(value[fieldName], output, variableIndex);
      } else {
        fixedIndex = fieldType.serializeTo(value[fieldName], output, fixedIndex);
      }
    }
    return variableIndex;
  }
  chunk(value: T, index: number): Uint8Array {
    const [fieldName, fieldType] = this._type.fields[index];
    return fieldType.hashTreeRoot(value[fieldName]);
  }
}
