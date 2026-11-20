import {expect, test, vi} from "vitest";
import type {NativeResponseChunk} from "../src/network.js";
import {NativeRequest} from "../src/network-request.js";

function request() {
  const pull = Promise.withResolvers<IteratorResult<NativeResponseChunk>>();
  const closed = Promise.withResolvers<Error | null>();
  const native = {requestPull: vi.fn(() => pull.promise), requestRetire: vi.fn()};
  const iterator = new NativeRequest(native, {closed: closed.promise, handle: {generation: 1n, index: 0}});
  return {closed, iterator, native, pull};
}

test("return between native pull settlement and its continuation preserves the chunk and settlement order", async () => {
  const {iterator, native, pull, closed} = request();
  const order: string[] = [];
  const pending = iterator.next();
  void pending.then(() => order.push("pull"));
  const chunk = {
    done: false as const,
    value: {
      data: new Uint8Array(4),
      fork: null,
      origin: {connection: {generation: 1, index: 0}, endpoint: null},
      protocol: "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
    } satisfies NativeResponseChunk,
  };
  pull.resolve(chunk);
  const retiring = iterator.return();
  void retiring.then(() => order.push("return"));
  closed.resolve(null);
  expect(await pending).toBe(chunk);
  expect(await retiring).toEqual({done: true, value: undefined});
  expect(order).toEqual(["pull", "return"]);
  expect(native.requestRetire).toHaveBeenCalledOnce();
  expect(await iterator.next()).toEqual({done: true, value: undefined});
});

test("a terminal error survives native cell retirement until the iterator is pulled", async () => {
  const {iterator, native, closed} = request();
  const error = new Error("disconnected");
  closed.resolve(error);
  await closed.promise;
  await expect(iterator.next()).rejects.toBe(error);
  expect(await iterator.next()).toEqual({done: true, value: undefined});
  expect(native.requestPull).not.toHaveBeenCalled();
});
