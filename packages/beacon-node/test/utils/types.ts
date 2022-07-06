import sinon from "sinon";
import {SinonStub, SinonStubbedInstance} from "sinon";

export type SinonStubFn<T extends (...args: any[]) => any> = T extends (...args: infer TArgs) => infer TReturnValue
  ? SinonStub<TArgs, TReturnValue>
  : never;

// eslint-disable-next-line @typescript-eslint/ban-types
type StubbableType<TType> = Function & {prototype: TType};

export function createStubInstance<TType>(constructor: StubbableType<TType>): SinonStubbedInstance<TType> & TType {
  return sinon.createStubInstance(constructor) as SinonStubbedInstance<TType> & TType;
}
