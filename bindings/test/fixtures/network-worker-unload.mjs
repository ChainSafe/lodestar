import assert from "node:assert/strict";
import {once} from "node:events";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {isMainThread, Worker, workerData} from "node:worker_threads";

// Only the workers load the addon, one after another, so each worker's environment is the addon's last one and
// ends before its thread exits.
if (isMainThread) {
  const directory = await mkdtemp(join(tmpdir(), "native-peer-worker-"));
  try {
    const codes = [];
    for (let i = 0; i < 3; i++) {
      console.error("phase worker", i);
      codes.push((await once(new Worker(new URL(import.meta.url), {workerData: directory}), "exit"))[0]);
      assert.deepEqual(await readdir(directory), ["native-remembered-peers.txt"]);
    }
    console.error("phase exit");
    console.log(`workers-exited ${codes.join(",")}`);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
} else {
  const {applicationConfig, startRuntime} = await import("../utils/network.js");
  await startRuntime({...applicationConfig(), peerStoreDir: workerData}).close();
}
