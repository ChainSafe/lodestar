import {Vector} from "../../interface";
import {BasicVectorType, CompositeVectorType} from "../../types";
import {mixInLength} from "../../util/compat";
import {BasicArrayByteArrayHandler, CompositeArrayByteArrayHandler} from "./array";
import {ByteArrayBacking} from "./abstract";

export class BasicVectorByteArrayHandler<T extends Vector<any>> extends BasicArrayByteArrayHandler<T> {
  _type: BasicVectorType<T>;
  constructor(type: BasicVectorType<T>) {
    super();
    this._type = type;
  }
  defaultBacking(): ByteArrayBacking {
    return new Uint8Array(this._type.elementType.size() * this._type.length);
  }
}

export class CompositeVectorByteArrayHandler<T extends Vector<any>> extends CompositeArrayByteArrayHandler<T> {
  _type: CompositeVectorType<T>;
  constructor(type: CompositeVectorType<T>) {
    super();
    this._type = type;
  }
  defaultBacking(): ByteArrayBacking {
    // @ts-ignore
    const defaultElementBacking = this._type.elementType.byteArray.defaultBacking();
    const totalSize = defaultElementBacking.length * this._type.length;
    const target = new Uint8Array(totalSize);
    for (let i = 0; i < totalSize; i += defaultElementBacking.length) {
      target.set(defaultElementBacking, i);
    }
    return target;
  }
}

