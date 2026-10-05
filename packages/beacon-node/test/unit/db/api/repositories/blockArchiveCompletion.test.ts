import {setImmediate} from "node:timers/promises";
import {describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {Db, DbReqOpts} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {BlockArchiveRepository} from "../../../../../src/db/repositories/blockArchive.js";
import {parentRootIndexBucketId, rootIndexBucketId} from "../../../../../src/db/repositories/blockArchiveIndex.js";

const operations = ["batchRemove"] as const;

function fixture(operation: (typeof operations)[number]) {
  const roots = [defer<void>(), defer<void>()];
  const parents = [defer<void>(), defer<void>()];
  const pending = new Map<string, typeof roots>([
    [rootIndexBucketId, [...roots]],
    [parentRootIndexBucketId, [...parents]],
  ]);
  const writeIndex = (opts?: DbReqOpts): Promise<void> => {
    const completion = opts?.bucketId ? pending.get(opts.bucketId)?.shift() : undefined;
    return completion?.promise ?? Promise.resolve();
  };
  const controller = {
    put: vi.fn<Db["put"]>((_key, _value, opts) => writeIndex(opts)),
    delete: vi.fn<Db["delete"]>((_key, opts) => writeIndex(opts)),
    batchPut: vi.fn<Db["batchPut"]>(async () => undefined),
    batchDelete: vi.fn<Db["batchDelete"]>(async () => undefined),
  } satisfies Pick<Db, "put" | "delete" | "batchPut" | "batchDelete">;
  const repository = new BlockArchiveRepository(config, controller as unknown as Db);
  const blocks = [1, 2].map((slot) => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    return block;
  });
  const run = (): Promise<void> => {
    switch (operation) {
      case "batchRemove":
        return repository.batchRemove(blocks);
    }
  };
  return {roots, parents, run};
}

describe.each(operations)("block archive %s completion", (operation) => {
  it("waits for every root and parent index operation before reporting success", async () => {
    const {roots, parents, run} = fixture(operation);
    const completed = vi.fn();
    const running = run().then(completed);
    try {
      await setImmediate();
      expect(completed).not.toHaveBeenCalled();
      for (const completion of [...roots, parents[0]]) completion.resolve();
      await setImmediate();
      expect(completed).not.toHaveBeenCalled();
      parents[1].resolve();
      await running;
      expect(completed).toHaveBeenCalledOnce();
    } finally {
      for (const completion of [...roots, ...parents]) completion.resolve();
      await running;
    }
  });

  it.each(["root", "parent"])("propagates a failed %s index operation", async (index) => {
    const {roots, parents, run} = fixture(operation);
    const error = new Error("index write failed");
    const failed = expect(run()).rejects.toBe(error);
    const rejected = (index === "root" ? roots : parents)[1];
    rejected.reject(error);
    for (const completion of [...roots, ...parents]) {
      if (completion !== rejected) completion.resolve();
    }
    await failed;
  });
});

describe.each(["batchPut", "batchPutBinary"] as const)("block archive %s completion", (operation) => {
  it.each([false, true])("awaits the atomic block and index batch (failure: %s)", async (fail) => {
    const completion = defer<void>();
    const batchPut = vi.fn<Db["batchPut"]>(() => completion.promise);
    const repository = new BlockArchiveRepository(config, {batchPut} as unknown as Db);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const running =
      operation === "batchPut"
        ? repository.batchPut([{key: 0, value: block}])
        : repository.batchPutBinary([
            {
              key: 0,
              slot: 0,
              value: ssz.phase0.SignedBeaconBlock.serialize(block),
              blockRoot: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
              parentRoot: block.message.parentRoot,
            },
          ]);
    const error = new Error("batch failed");
    const result = fail ? expect(running).rejects.toBe(error) : expect(running).resolves.toBeUndefined();
    let settled = false;
    void running.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await setImmediate();
    expect(settled).toBe(false);
    expect(batchPut).toHaveBeenCalledOnce();
    expect(batchPut.mock.calls[0][0]).toHaveLength(4);
    if (fail) completion.reject(error);
    else completion.resolve();
    await result;
  });
});
