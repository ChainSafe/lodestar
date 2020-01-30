import {Vector} from "../../interface";
import {BasicVectorType, CompositeVectorType} from "../../types";
import {BasicArrayStructuralHandler, CompositeArrayStructuralHandler} from "./array";

export class BasicVectorStructuralHandler<T extends Vector<unknown>> extends BasicArrayStructuralHandler<T> {
  _type: BasicVectorType<T>;
  constructor(type: BasicVectorType<T>) {
    super();
    this._type = type;
  }
  defaultValue(): T {
    return Array.from({length: this._type.length}, () => {
      return this._type.elementType.defaultValue();
    }) as unknown as T;
  }
  getLength(value: T): number {
    return this._type.length;
  }
  fromBytes(data: Uint8Array, start: number, end: number): T {
    if ((end - start) / this._type.elementType.size() !== this._type.length) {
      throw new Error("Incorrect deserialized vector length");
    }
    return super.fromBytes(data, start, end);
  }
  assertValidValue(value: unknown): asserts value is T {
    const actualLength = (value as T).length;
    const expectedLength = this.getLength((value as T));
    if (actualLength !== expectedLength) {
      throw new Error(`Invalid vector length: expected ${expectedLength}, actual ${actualLength}`);
    }
    // @ts-ignore
    super.assertValidValue(value);
  }
}

export class CompositeVectorStructuralHandler<T extends Vector<object>> extends CompositeArrayStructuralHandler<T> {
  _type: CompositeVectorType<T>;
  constructor(type: CompositeVectorType<T>) {
    super();
    this._type = type;
  }
  defaultValue(): T {
    return Array.from({length: this.type.length}, () => {
      return this._type.elementType.structural.defaultValue();
    }) as unknown as T;
  }
  getLength(value: T): number {
    return this._type.length;
  }
  fromBytes(data: Uint8Array, start: number, end: number): T {
    const value = super.fromBytes(data, start, end);
    if (value.length !== this._type.length) {
      throw new Error("Incorrect deserialized vector length");
    }
    return value;
  }
  assertValidValue(value: unknown): asserts value is T {
    const actualLength = (value as T).length;
    const expectedLength = this.getLength(value as T);
    if (actualLength !== expectedLength) {
      throw new Error(`Invalid vector length: expected ${expectedLength}, actual ${actualLength}`);
    }
    // @ts-ignore
    super.assertValidValue(value);
  }
}
