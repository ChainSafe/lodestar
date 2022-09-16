import {SinonStub} from "sinon";
import {toHex} from "@lodestar/utils";

export const ZERO_HASH = Buffer.alloc(32, 0);
export const ZERO_HASH_HEX = toHex(ZERO_HASH);

export type SinonStubFn<T extends (...args: any[]) => any> = T extends (...args: infer TArgs) => infer TReturnValue
  ? SinonStub<TArgs, TReturnValue>
  : never;
