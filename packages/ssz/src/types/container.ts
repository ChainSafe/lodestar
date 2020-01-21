import {ObjectLike} from "../interface";
import {CompositeType, Type} from "./abstract";
import {
  ContainerStructuralHandler,
  ContainerTreeHandler,
} from "../backings";

export interface IContainerOptions {
  fields: [string, Type<any>][];
}

export class ContainerType<T extends ObjectLike=any> extends CompositeType<T> {
  fields: [string, Type<any>][];
  constructor(options: IContainerOptions) {
    super();
    this.fields = options.fields;
    this.structural = new ContainerStructuralHandler(this);
    this.tree = new ContainerTreeHandler(this);
  }
  indexElementType(index: number): Type<any> {
    return this.fields[index][1];
  }
  isVariableSize(): boolean {
    return this.fields.some(([fieldName, fieldType]) =>
      fieldType.isVariableSize());
  }
  chunkCount(): number {
    return this.fields.length;
  }
}
