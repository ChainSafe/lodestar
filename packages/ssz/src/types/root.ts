import {ByteVectorType} from "./byteVector";
import {CompositeType} from "./abstract";

/**
 * Allow for lazily evaulated expandedType thunk
 */
export interface IRootOptions<T extends object> {
  expandedType: CompositeType<T> | (() => CompositeType<T>);
}

export class RootType<T extends object> extends ByteVectorType {
  _expandedType: CompositeType<T> | (() => CompositeType<T>);
  constructor(options: IRootOptions<T>) {
    super({length: 32});
    this._expandedType = options.expandedType;
  }
  get expandedType(): CompositeType<T> {
    if (typeof this._expandedType === 'function') {
      this._expandedType = this._expandedType();
    }
    return this._expandedType;
  }
}
