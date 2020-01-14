import {CompositeType, Type, BasicType} from "./abstract";

// Typescript has an ArrayLike, but it is readonly
export interface ArrayLike<T> {
  readonly length: number;
  [n: number]: T;
}

export interface IArrayOptions {
  elementType: Type<any>;
}

export class ArrayType<T extends ArrayLike<any>> extends CompositeType<T> {
  elementType: Type<any>;
  constructor(options: IArrayOptions) {
    super();
    this.elementType = options.elementType;
  }
  indexElementType(index: number): Type<any> {
    return this.elementType;
  }
}

export class BasicArrayType<T extends ArrayLike<any>> extends ArrayType<T> {
  elementType: BasicType<any>;
}

export class CompositeArrayType<T extends ArrayLike<any>> extends ArrayType<T> {
  elementType: CompositeType<any>;
}
