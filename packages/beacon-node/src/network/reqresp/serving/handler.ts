import {ProtocolHandler, RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/interface.js";
import {ServingConfigurationError, ServingContext, isServingCapacityError} from "../../../chain/serving/context.js";
import {IBeaconDb} from "../../../db/interface.js";
import {getReqRespHandlers} from "../handlers/index.js";
import {GetReqRespHandlerFn, ReqRespMethod} from "../types.js";
import {HostServingBudget, ServingLease} from "./budget.js";
import {assertSupportedServingSlot} from "./policy.js";

export class LocalServingResponseError extends ResponseError {
  readonly code = "HOST_SERVING_CAPACITY";
  constructor() {
    super(RespStatus.SERVER_ERROR, "Local serving capacity exhausted");
  }
}

export interface ServingHandler extends AsyncIterableIterator<ResponseOutgoing> {
  cancel(): void;
  readonly retired: Promise<void>;
}

export type BoundedReqRespHandlers = (
  method: ReqRespMethod
) => (...args: Parameters<ProtocolHandler>) => ServingHandler;
const boundedFactories = new WeakMap<GetReqRespHandlerFn, HostServingBudget>();

export function servingBudget(factory: GetReqRespHandlerFn): HostServingBudget {
  const budget = boundedFactories.get(factory);
  if (!budget) throw new ServingConfigurationError("Native network requires bounded serving handlers");
  return budget;
}

export function assertBoundedReqRespHandlers(factory: GetReqRespHandlerFn): asserts factory is BoundedReqRespHandlers {
  if (!boundedFactories.has(factory))
    throw new ServingConfigurationError("Native network requires bounded serving handlers");
}

/** route must drop the adapter's native route synchronously, before iterator cleanup. */
export function startServingHandler(
  budget: HostServingBudget,
  factory: (context: ServingContext) => AsyncIterable<ResponseOutgoing>,
  route: (() => void) | undefined = undefined
): ServingHandler {
  let lease: ServingLease;
  try {
    lease = budget.acquire();
  } catch (error) {
    if (isServingCapacityError(error)) throw new LocalServingResponseError();
    throw error;
  }
  let iterator: AsyncIterator<ResponseOutgoing> | undefined;
  let closed = false;
  let pulling = false;
  let returning: Promise<IteratorResult<ResponseOutgoing>> | undefined;
  const clear = (): void => {
    const current = route;
    route = undefined;
    current?.();
  };
  const requestReturn = (): Promise<IteratorResult<ResponseOutgoing>> => {
    if (!returning) {
      returning = lease.track(async () => {
        try {
          return iterator?.return ? await iterator.return() : {done: true, value: undefined};
        } finally {
          iterator = undefined;
        }
      });
      void returning.catch(() => {});
    }
    return returning;
  };
  try {
    iterator = factory(lease.context)[Symbol.asyncIterator]();
  } catch (error) {
    try {
      clear();
    } finally {
      lease.finish();
    }
    if (isServingCapacityError(error)) throw new LocalServingResponseError();
    throw error;
  }
  const handler: ServingHandler = {
    retired: lease.retired,
    [Symbol.asyncIterator]() {
      return this;
    },
    cancel() {
      if (closed) return;
      closed = true;
      try {
        clear();
      } finally {
        lease.cancel();
        void requestReturn();
        lease.finish();
      }
    },
    async return() {
      if (!closed) handler.cancel();
      if (returning) await returning;
      return {done: true, value: undefined};
    },
    async next() {
      if (closed) return {done: true, value: undefined};
      if (pulling) throw new ServingConfigurationError("Concurrent serving pull");
      pulling = true;
      try {
        const result = await lease.track(async () => {
          if (!iterator) throw new ServingConfigurationError("Missing serving iterator");
          return iterator.next();
        });
        if (closed) return {done: true, value: undefined};
        if (result.done) {
          closed = true;
          iterator = undefined;
          try {
            clear();
          } finally {
            lease.finish();
          }
        }
        return result;
      } catch (error) {
        if (!closed) {
          closed = true;
          try {
            clear();
          } finally {
            void requestReturn();
            lease.finish();
          }
        }
        if (isServingCapacityError(error)) throw new LocalServingResponseError();
        throw error;
      } finally {
        pulling = false;
      }
    },
  };
  return handler;
}

export function getBoundedReqRespHandlers(
  modules: {chain: IBeaconChain; db: IBeaconDb},
  budget: HostServingBudget
): BoundedReqRespHandlers {
  if (modules.db.boundedReadVersion !== 1)
    throw new ServingConfigurationError("Actual bounded DB capability v1 required");
  assertSupportedServingSlot(modules.chain.config, modules.chain.clock.currentSlot);
  const factory: BoundedReqRespHandlers =
    (method) =>
    (...args) =>
      startServingHandler(budget, (context) => {
        assertSupportedServingSlot(modules.chain.config, modules.chain.clock.currentSlot);
        return getReqRespHandlers(modules, context)(method)(...args);
      });
  boundedFactories.set(factory, budget);
  return factory;
}
