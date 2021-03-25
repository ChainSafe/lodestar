import {SinonStub} from "sinon";

export type SinonStubFn<T extends (...args: any[]) => any> = T extends (...args: infer TArgs) => infer TReturnValue
  ? SinonStub<TArgs, TReturnValue>
  : never;
