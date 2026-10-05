import {ProtocolHandler, RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/interface.js";
import {ServingConfigurationError, ServingContext, isServingCapacityError} from "../../../chain/serving/context.js";
import {IBeaconDb} from "../../../db/interface.js";
import {getReqRespHandlers} from "../handlers/index.js";
import {ReqRespMethod} from "../types.js";
import {HostServingBudget, ServingLease} from "./budget.js";
import {assertSupportedServingSlot} from "./policy.js";

export class LocalServingResponseError extends ResponseError {
  readonly code = "HOST_SERVING_CAPACITY";
  constructor() {
    super(RespStatus.SERVER_ERROR, "Local serving capacity exhausted");
  }
}

export interface ServingHandler extends AsyncIterableIterator<ResponseOutgoing> {
  prepare(): Promise<void>;
  cancel(): void;
  readonly retired: Promise<void>;
}

export type BoundedReqRespHandlers = (
  method: ReqRespMethod
) => (...args: Parameters<ProtocolHandler>) => ServingHandler;
export type BoundedServing = {getHandler: BoundedReqRespHandlers; budget: HostServingBudget};

export function startServingHandler(
  budget: HostServingBudget,
  factory: (context: ServingContext) => AsyncIterable<ResponseOutgoing>,
  peer = "",
  method = ReqRespMethod.BeaconBlocksByRoot
): ServingHandler {
  let lease: ServingLease;
  try {
    lease = budget.acquire(peer, method);
  } catch (error) {
    if (isServingCapacityError(error)) throw new LocalServingResponseError();
    throw error;
  }
  let iterator: AsyncIterator<ResponseOutgoing> | undefined;
  let closed = false;
  let pulling = false;
  let returning: Promise<IteratorResult<ResponseOutgoing>> | undefined;
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
  const handler: ServingHandler = {
    retired: lease.retired,
    prepare() {
      return lease.track(() => lease.prepare());
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    cancel() {
      if (closed) return;
      closed = true;
      lease.cancel();
      void requestReturn();
      lease.finish();
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
          await lease.startWork();
          iterator ??= factory(lease.context)[Symbol.asyncIterator]();
          return iterator.next();
        });
        if (closed) return {done: true, value: undefined};
        if (result.done) {
          closed = true;
          iterator = undefined;
          lease.finish();
        }
        return result;
      } catch (error) {
        if (!closed) {
          closed = true;
          void requestReturn();
          lease.finish();
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

export function createBoundedServing(
  modules: {chain: IBeaconChain; db: IBeaconDb},
  budget: HostServingBudget
): BoundedServing {
  assertSupportedServingSlot(modules.chain.config, modules.chain.clock.currentSlot);
  const factory: BoundedReqRespHandlers =
    (method) =>
    (...args) => {
      assertSupportedServingSlot(modules.chain.config, modules.chain.clock.currentSlot);
      return startServingHandler(
        budget,
        (context) => {
          assertSupportedServingSlot(modules.chain.config, modules.chain.clock.currentSlot);
          return getReqRespHandlers(modules, context)(method)(...args);
        },
        args[1].toString(),
        method
      );
    };
  return {getHandler: factory, budget};
}
