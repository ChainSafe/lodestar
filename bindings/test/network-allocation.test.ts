import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {expect, test} from "vitest";
import {childTestTimeout, spawnChild, spawnCommand} from "./utils/network.js";

/** A publication payload length nothing else in the process allocates. */
const refusedBytes = 654321;
/** The fault shim forwards every other allocation to glibc. */
const glibc = Boolean(
  (process.report.getReport() as {header?: {glibcVersionRuntime?: string}}).header?.glibcVersionRuntime
);

// The network allocator's OutOfMemory is operation-local: it refuses that publication alone, and the network stays
// running until a requested close.
test.skipIf(!glibc)(
  "a publication whose payload copy cannot be allocated rejects alone and never escalates",
  childTestTimeout(2),
  () => {
    const directory = mkdtempSync(join(tmpdir(), "lodestar-z-malloc-"));
    try {
      const shim = join(directory, "fault.so");
      const source = join(import.meta.dirname, "fixtures", "network-malloc-fault.c");
      const built = spawnCommand("zig", ["cc", "-shared", "-fPIC", "-O2", "-o", shim, source]);
      expect(built.status, built.stderr).toBe(0);
      const script = `import {createNativeNetwork} from "./bindings/src/network.js";
        import {applicationConfig, topicName} from "./bindings/test/utils/network.ts";
        const host = {
          subscribeCapacity: () => () => {},
          capacity: () => ({gossipValidation: "ready"}),
          validate: (job) => Promise.resolve(job.messages.map(() => "ignore")),
          checkDependencies: (checks) => checks.map(() => false),
          serve: (request) => request.cancel(),
          peers: () => undefined,
          failed: () => undefined,
          logs: () => undefined,
        };
        const network = createNativeNetwork(applicationConfig(), host);
        const publish = (bytes) => network.publish(topicName(), new Uint8Array(bytes), {allowZeroPeers: true});
        const refused = await publish(${refusedBytes}).then(() => "published", (error) => error.code);
        const admitted = await publish(${refusedBytes + 1});
        console.log(JSON.stringify({admitted, closed: await network.close(), refused}));`;
      const child = spawnChild(["--import", "tsx", "--input-type=module", "-e", script], {
        ...process.env,
        LD_PRELOAD: shim,
        NETWORK_MALLOC_FAULT_BYTES: String(refusedBytes),
      });
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        admitted: {duplicate: false, pressured: 0, queued: 0, selected: 0, unavailable: 0},
        closed: {reason: "requested"},
        refused: "OutOfMemory",
      });
    } finally {
      rmSync(directory, {force: true, recursive: true});
    }
  }
);
