import {once} from "node:events";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {Worker} from "node:worker_threads";
import {expect, it} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController} from "../../../src/controller/level.js";

it("shares writes across worker connections and keeps the main connection open after worker close", async () => {
  const name = await mkdtemp(path.join(os.tmpdir(), "lodestar-db-worker-"));
  const db = await LevelDbController.create({name}, {logger: getEnvLogger()});
  let worker: Worker | undefined;
  try {
    await db.put(Uint8Array.of(1), Uint8Array.of(11));
    worker = new Worker(new URL("../../fixtures/levelWorker.mjs", import.meta.url), {workerData: {name}});
    const [[readByWorker], [exitCode]] = await Promise.all([once(worker, "message"), once(worker, "exit")]);
    expect(exitCode).toBe(0);
    expect(readByWorker).toEqual(Uint8Array.of(11));
    expect(await db.get(Uint8Array.of(2))).toEqual(Buffer.from([22]));
    await db.put(Uint8Array.of(3), Uint8Array.of(33));
    expect(await db.get(Uint8Array.of(3))).toEqual(Buffer.from([33]));
  } finally {
    await worker?.terminate();
    await db.close();
    await rm(name, {recursive: true, force: true});
  }
});
