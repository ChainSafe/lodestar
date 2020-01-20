import {ByteVectorType} from "./byteVector";
import {CompositeType} from "./abstract";

export interface IRootOptions<T extends object> {
  expandedType: CompositeType<T>;
}

export class RootType<T extends object> extends ByteVectorType {
  expandedType: CompositeType<T>;
  constructor(options: IRootOptions<T>) {
    super({length: 32});
    this.expandedType = options.expandedType;
  }
}
