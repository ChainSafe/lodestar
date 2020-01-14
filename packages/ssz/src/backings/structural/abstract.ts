import {CompositeType} from "../../types";
import {merkleize} from "../../util/compat";

/**
 * StructuralHandler differs slightly from the TreeHandler in that it is NOT a ProxyHandler.
 * It is only meant to be called via the CompositeType.structural object, rather than through a Proxied call.
 * It also acts on targets of type T rather than TreeBackedValue<T>.
 */
export class StructuralHandler<T extends object> {
  _type: CompositeType<T>;
  constructor(type: CompositeType<T>) {
    this._type = type;
  }
  type(): CompositeType<T> {
    return this._type;
  }
  defaultValue(): T {
    throw new Error("Not implemented");
  }
  clone(target: T): T {
    throw new Error("Not implemented");
  }
  size(target: T): number {
    throw new Error("Not implemented");
  }
  assertValidValue(target: T): void {
    throw new Error("Not implemented");
  }
  equals(target: T, other: T): boolean {
    throw new Error("Not implemented");
  }
  deserialize(data: Uint8Array): T {
    throw new Error("Not implemented");
  }
  serialize(target: T): Uint8Array {
    const output = new Uint8Array(this._type.size(target));
    this.serializeTo(target, output, 0);
    return output;
  }
  serializeTo(target: T, output: Uint8Array, offset: number): number {
    throw new Error("Not implemented");
  }
  nonzeroChunkCount(value: T): number {
    return this._type.chunkCount();
  }
  chunk(value: T, index: number): Uint8Array {
    throw new Error("Not implemented");
  }
  chunks(value: T): Iterable<Uint8Array> {
    const t = this;
    const chunkCount = this.nonzeroChunkCount(value);
    const iterator = function* () {
      for (let i = 0; i < chunkCount; i++) {
        yield t.chunk(value, i);
      }
    };
    return iterator();
  }
  hashTreeRoot(target: T): Uint8Array {
    return merkleize(this.chunks(target), this._type.chunkCount());
  }
}
