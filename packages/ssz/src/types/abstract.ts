import {
  BackedValue, isBackedValue,
  StructuralHandler, TreeHandler,
} from "../backings";

export type Type<T> = BasicType<T> | (T extends object ? CompositeType<T>: never);

export class BasicType<T> {
  isVariableSize(): boolean {
    return false;
  }
  isBasic(): this is BasicType<T> {
    return true;
  }
  size(): number {
    throw new Error("Not implemented");
  }
  assertValidValue(value: any): void {
    throw new Error("Not implemented");
  }
  clone(value: T): T {
    return value;
  }
  equals(value1: T, value2: T): boolean {
    this.assertValidValue(value1);
    this.assertValidValue(value2);
    return value1 === value2;
  }
  toBytes(value: T, output: Uint8Array, offset: number): number {
    throw new Error("Not implemented");
  }
  fromBytes(data: Uint8Array, offset: number): T {
    throw new Error("Not implemented");
  }
  deserialize(data: Uint8Array): T {
    return this.fromBytes(data, 0);
  }
  defaultValue(): T {
    throw new Error("Not implemented");
  }
  createValue(value: any): T {
    this.assertValidValue(value);
    return value;
  }
  serialize(value: T): Uint8Array {
    const output = new Uint8Array(this.size());
    this.serializeTo(value, output, 0);
    return output;
  }
  serializeTo(value: T, output: Uint8Array, offset: number): number {
    throw new Error("Not implemented");
  }
  hashTreeRoot(value: T): Uint8Array {
    const output = new Uint8Array(32);
    this.serializeTo(value, output, 0);
    return output;
  }
}

export class CompositeType<T extends object> {
  structural: StructuralHandler<T>;
  tree: TreeHandler<T>;

  indexElementType(index: number): Type<any> {
    throw new Error("Not implemented");
  }
  isVariableSize(): boolean {
    throw new Error("Not implemented");
  }
  isBasic(): this is BasicType<T> {
    return false;
  }
  size(value: BackedValue<T> | T): number {
    if (isBackedValue(value)) {
      return value.size();
    } else {
      return this.structural.size(value);
    }
  }
  assertValidValue(value: any): void {
    this.structural.assertValidValue(value);
  }
  equals(value1: BackedValue<T> | T, value2: BackedValue<T> | T): boolean {
    if (isBackedValue(value1) && isBackedValue(value2)) {
      return value1.equals(value2);
    } else {
      return this.structural.equals(value1, value2);
    }
  }
  defaultValue(): T {
    return this.structural.defaultValue();
  }
  clone(value: BackedValue<T> | T): BackedValue<T> | T {
    if (isBackedValue(value)) {
      return value.clone() as BackedValue<T>;
    } else {
      return this.structural.clone(value);
    }
  }
  createValue(value: any): T {
    throw new Error("Not implemented");
  }
  // serialize related
  deserialize(data: Uint8Array): T {
    return this.structural.deserialize(data);
  }
  serialize(value: BackedValue<T> | T): Uint8Array {
    if (isBackedValue(value)) {
      return value.serialize();
    } else {
      return this.structural.serialize(value);
    }
  }
  serializeTo(value: BackedValue<T> | T, output: Uint8Array, offset: number): number {
    if (isBackedValue(value)) {
      return value.serializeTo(output, offset);
    } else {
      return this.structural.serializeTo(value, output, offset);
    }
  }
  // hash tree root related
  chunkCount(): number {
    throw new Error("Not implemented");
  }
  /*
  nonzeroChunkCount(value: BackedValue<T> | T): number {
    if (isBackedValue(value)) {
      return value.nonzeroChunkCount();
    } else {
      return this.structural.nonzeroChunkCount(value);
    }
  }
  chunk(value: BackedValue<T> | T, index: number): Uint8Array {
    if (isBackedValue(value)) {
      return value.chunk(index);
    } else {
      return this.structural.chunk(value, index);
    }
  }
  chunks(value: BackedValue<T> | T): Iterable<Uint8Array> {
    if (isBackedValue(value)) {
      return value.chunks();
    } else {
      return this.structural.chunks(value);
    }
  }
   */
  hashTreeRoot(value: BackedValue<T> | T): Uint8Array {
    if (isBackedValue(value)) {
      return value.hashTreeRoot();
    } else {
      return this.structural.hashTreeRoot(value);
    }
  }
}
