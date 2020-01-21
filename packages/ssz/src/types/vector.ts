import {ArrayLike, IArrayOptions, BasicArrayType, CompositeArrayType} from "./array";
import {
  BasicVectorStructuralHandler, CompositeVectorStructuralHandler,
  BasicVectorTreeHandler, CompositeVectorTreeHandler,
} from "../backings";

export interface IVectorOptions extends IArrayOptions {
  length: number;
}

export type VectorType<T extends ArrayLike<any>=any> = BasicVectorType<T> | CompositeVectorType<T>;
type VectorTypeConstructor = {
  new<T extends ArrayLike<any>>(options: IVectorOptions): VectorType<T>;
};

// Trick typescript into treating VectorType as a constructor
export const VectorType: VectorTypeConstructor =
  function VectorType<T extends ArrayLike<any>=any>(options: IVectorOptions): VectorType<T> {
    if (options.elementType.isBasic()) {
      return new BasicVectorType(options);
    } else {
      return new CompositeVectorType(options);
    }
  } as unknown as VectorTypeConstructor;

export class BasicVectorType<T extends ArrayLike<any>=any> extends BasicArrayType<T> {
  length: number;
  constructor(options: IVectorOptions) {
    super(options);
    this.length = options.length;
    this.structural = new BasicVectorStructuralHandler(this);
    this.tree = new BasicVectorTreeHandler(this);
  }
  isVariableSize(): boolean {
    return false;
  }
  chunkCount(): number {
    return Math.ceil(this.length * this.elementType.size() / 32);
  }
}

export class CompositeVectorType<T extends ArrayLike<any>> extends CompositeArrayType<T> {
  length: number;
  constructor(options: IVectorOptions) {
    super(options);
    this.length = options.length;
    this.structural = new CompositeVectorStructuralHandler(this);
    this.tree = new CompositeVectorTreeHandler(this);
  }
  isVariableSize(): boolean {
    return this.elementType.isVariableSize();
  }
  chunkCount(): number {
    return this.length;
  }
}
