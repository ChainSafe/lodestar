import {ArrayLike} from "../../interface";
import {Type} from "../type";
import {BasicType} from "../basic";
import {CompositeType} from "./abstract";

export interface IArrayOptions {
  elementType: Type<any>;
}

export class BasicArrayType<T extends ArrayLike<any>> extends CompositeType<T> {
  elementType: BasicType<any>;
  constructor(options: IArrayOptions) {
    super();
    this.elementType = options.elementType as BasicType<T>;
  }
  indexElementType(index: number): Type<any> {
    return this.elementType;
  }
}

export class CompositeArrayType<T extends ArrayLike<any>> extends CompositeType<T> {
  elementType: CompositeType<any>;
  constructor(options: IArrayOptions) {
    super();
    this.elementType = options.elementType as CompositeType<T>;
  }
  indexElementType(index: number): Type<any> {
    return this.elementType;
  }
}
