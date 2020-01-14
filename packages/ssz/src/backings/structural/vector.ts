import {BasicVectorType, CompositeVectorType} from "../../types";
import {BasicArrayStructuralHandler, CompositeArrayStructuralHandler} from "./array";

export class BasicVectorStructuralHandler<T extends ArrayLike<any>> extends BasicArrayStructuralHandler<T> {
  _type: BasicVectorType<T>;
  defaultValue(): T {
    return Array.from({length: this._type.length}, () => {
      return this._type.elementType.defaultValue();
    }) as unknown as T;
  }
  getLength(value: T): number {
    return this._type.length;
  }
}

export class CompositeVectorStructuralHandler<T extends ArrayLike<any>> extends CompositeArrayStructuralHandler<T> {
  _type: CompositeVectorType<T>;
  defaultValue(): T {
    return Array.from({length: this.type.length}, () => {
      return this._type.elementType.structural.defaultValue();
    }) as unknown as T;
  }
  getLength(value: T): number {
    return this._type.length;
  }
}
