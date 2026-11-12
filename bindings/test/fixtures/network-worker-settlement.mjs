import assert from "node:assert/strict";
import {createSocket} from "node:dgram";
import {once} from "node:events";
import {isMainThread, parentPort, Worker} from "node:worker_threads";
import {applicationConfig, holdSettling, localIntent, runtimeReleased, startRuntime, topicName} from "../utils/network.js";

if (isMainThread) {
  // Each phase line names the step that follows, for the parent's watchdog to report.
  const phase = (name) => console.error("phase", name);
  phase("worker runtime");
  const worker = new Worker(new URL(import.meta.url));
  try {
    const [{port}] = await once(worker, "message");
    phase("worker termination");
    await worker.terminate();
    phase("port rebind");
    const socket = createSocket("udp4");
    try {
      socket.bind(port, "127.0.0.1");
      await once(socket, "listening");
    } finally {
      socket.close();
    }
    phase("runtime release");
    // Teardown with pending results returned the worker runtime's process claim.
    await runtimeReleased();
    phase("second runtime");
    await startRuntime(applicationConfig()).close();
    phase("exit");
    console.log("worker-settlement-released");
  } finally {
    await worker.terminate();
  }
} else {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  await runtime.applyIntent(localIntent(config));
  holdSettling(runtime, true);
  const payload = new Uint8Array(4000);
  new DataView(payload.buffer).setBigUint64(100, 100n, true);
  const pending = [];
  for (let i = 0; i < 16; i++) {
    pending.push(runtime.publishGossip(topicName(), payload, {allowZeroPeers: true, ignoreDuplicate: true}));
    pending.push(runtime.reStatusPeers([]));
  }
  void Promise.allSettled(pending);
  parentPort.postMessage({
    port: runtime.identity.localEndpoint.port,
  });
  setInterval(() => {}, 1000);
}
