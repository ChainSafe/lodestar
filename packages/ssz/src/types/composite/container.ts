import {ObjectLike} from "../../interface";
import {CompositeType} from "./abstract";
import {Type} from "../type";
import {
  ContainerStructuralHandler,
  ContainerTreeHandler,
  ContainerByteArrayHandler,
} from "../../backings";

export interface IContainerOptions {
  fields: Record<string, Type<any>>;
}

export class ContainerType<T extends ObjectLike=any> extends CompositeType<T> {
  // ES6 ensures key order is chronological
  fields: Record<string, Type<any>>;
  constructor(options: IContainerOptions) {
    super();
    this.fields = {...options.fields};
    this.structural = new ContainerStructuralHandler(this);
    this.tree = new ContainerTreeHandler(this);
    this.byteArray = new ContainerByteArrayHandler(this);
  }
  isVariableSize(): boolean {
    return Object.values(this.fields).some((fieldType) => fieldType.isVariableSize());
  }
  chunkCount(): number {
    return Object.keys(this.fields).length;
  }
}
