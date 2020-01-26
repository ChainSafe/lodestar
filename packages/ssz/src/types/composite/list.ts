import {List} from "../../interface";
import {IArrayOptions, BasicArrayType, CompositeArrayType} from "./array";
import {
  BasicListStructuralHandler, CompositeListStructuralHandler,
  BasicListTreeHandler, CompositeListTreeHandler,
  BasicListByteArrayHandler, CompositeListByteArrayHandler,
} from "../../backings";

export interface IListOptions extends IArrayOptions {
  limit: number;
}

export type ListType<T extends List<any>=any> = BasicListType<T> | CompositeListType<T>;
type ListTypeConstructor = {
  new<T extends List<any>>(options: IListOptions): ListType<T>;
};

// Trick typescript into treating ListType as a constructor
export const ListType: ListTypeConstructor =
  function ListType<T extends List<any>=any>(options: IListOptions): ListType<T> {
    if (options.elementType.isBasic()) {
      return new BasicListType(options);
    } else {
      return new CompositeListType(options);
    }
  } as unknown as ListTypeConstructor;

export class BasicListType<T extends List<any>=any> extends BasicArrayType<T> {
  limit: number;
  constructor(options: IListOptions) {
    super(options);
    this.limit = options.limit;
    this.structural = new BasicListStructuralHandler(this);
    this.tree = new BasicListTreeHandler(this);
    this.byteArray = new BasicListByteArrayHandler(this);
  }
  isVariableSize(): boolean {
    return true;
  }
  chunkCount(): number {
    return Math.ceil(this.limit * this.elementType.size() / 32);
  }
}

export class CompositeListType<T extends List<any>=any> extends CompositeArrayType<T> {
  limit: number;
  constructor(options: IListOptions) {
    super(options);
    this.limit = options.limit;
    this.structural = new CompositeListStructuralHandler(this);
    this.tree = new CompositeListTreeHandler(this);
    this.byteArray = new CompositeListByteArrayHandler(this);
  }
  isVariableSize(): boolean {
    return true;
  }
  chunkCount(): number {
    return this.limit;
  }
}
