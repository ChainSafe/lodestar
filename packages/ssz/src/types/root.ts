import {CompositeType} from "./abstract";

export interface IRootOptions {
  summarizedType: CompositeType<any>;
}

export class RootType<T extends object> extends CompositeType<T> {
  summarizedType: CompositeType<any>;
  constructor(options: IRootOptions) {
    super();
    this.summarizedType = options.summarizedType;
  }
}
