import {BasicListType, CompositeListType} from "../../types";
import {mixInLength} from "../../util/compat";
import {BasicArrayStructuralHandler, CompositeArrayStructuralHandler} from "./array";

export class BasicListStructuralHandler<T extends ArrayLike<any>> extends BasicArrayStructuralHandler<T> {
  _type: BasicListType<T>;
  defaultValue(): T {
    return [] as unknown as T;
  }
  getLength(value: T): number {
    return value.length;
  }
  nonzeroChunkCount(value: T): number {
    return Math.ceil(value.length * this._type.elementType.size() / 32);
  }
  hashTreeRoot(value: T): Uint8Array {
    return mixInLength(super.hashTreeRoot(value), value.length); 
  }
}

export class CompositeListStructuralHandler<T extends ArrayLike<any>> extends CompositeArrayStructuralHandler<T> {
  _type: CompositeListType<T>;
  defaultValue(): T {
    return [] as unknown as T;
  }
  getLength(value: T): number {
    return value.length;
  }
  nonzeroChunkCount(value: T): number {
    return value.length;
  }
  hashTreeRoot(value: T): Uint8Array {
    return mixInLength(super.hashTreeRoot(value), value.length); 
  }
}
