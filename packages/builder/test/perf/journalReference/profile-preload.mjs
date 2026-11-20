// Test-only timing wrappers. Every original filesystem operation is called once, unchanged.
import fs from "node:fs";
import {performance} from "node:perf_hooks";
import {isMainThread, parentPort, workerData} from "node:worker_threads";
if (!isMainThread && workerData.profilePort) {
  const port = workerData.profilePort;
  const fds = new Map();
  let current;
  const stamp = () => performance.timeOrigin + performance.now();
  const open = fs.openSync.bind(fs),
    close = fs.closeSync.bind(fs),
    fstat = fs.fstatSync.bind(fs);
  fs.openSync = (...args) => {
    const fd = open(...args);
    fds.set(fd, fstat(fd).isDirectory() ? "directory" : "file");
    return fd;
  };
  fs.closeSync = (...args) => {
    try {
      return close(...args);
    } finally {
      fds.delete(args[0]);
    }
  };
  for (const method of ["fsyncSync", "linkSync", "lstatSync", "renameSync", "unlinkSync", "writeFileSync"]) {
    const original = fs[method].bind(fs);
    fs[method] = (...args) => {
      const started = performance.now();
      try {
        return original(...args);
      } finally {
        if (current) {
          const name = method === "fsyncSync" ? `${fds.get(args[0]) ?? "unknown"}Sync` : method;
          const phase = (current.phases[name] ??= {count: 0, elapsedMs: 0});
          phase.count++;
          phase.elapsedMs += performance.now() - started;
        }
      }
    };
  }
  parentPort.on("message", (message) => {
    current = {id: message.id, kind: message.operation?.kind, startAt: stamp(), phases: {}};
  });
  const send = parentPort.postMessage.bind(parentPort);
  parentPort.postMessage = (...args) => {
    const reply = args[0];
    if (current && reply.id === current.id) {
      const row = {...current, finishAt: stamp(), error: reply.error ?? null};
      current = undefined;
      port.postMessage(row);
    }
    return send(...args);
  };
}
