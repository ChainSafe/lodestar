import {expect, test} from "vitest";
import type {HostCapacity, NativeForkEntry, NativeIdentity} from "../src/network.js";
import type {NativeDelivery, NativeRuntimeCloseResult} from "../src/network-types.js";
import {applicationConfig, childTestTimeout, gossipAll, localIntent, requestForks, runChild} from "./utils/network.js";
import {BLOCKS} from "./utils/network-incoming.js";
import {startPeer} from "./utils/network-peer.js";

test.each(["exit", "object-gc", "ready-close", "late-retire", "held-ack", "held-closed", "notifier"])(
  "incoming lifecycle subprocess %s",
  childTestTimeout(),
  (mode) => {
    const output = runChild([
      "--import",
      "tsx",
      "--expose-gc",
      "bindings/test/fixtures/network-incoming-lifecycle.mjs",
      mode,
    ]);
    expect(output).toContain(`incoming-lifecycle ${mode} ok`);
  }
);

interface IncomingHandle {
  index: number;
  generation: bigint;
}
interface IncomingDescriptor {
  handle: IncomingHandle;
  closed: Promise<void>;
}
interface DirectIncomingBridge {
  initialize(
    config: ReturnType<typeof applicationConfig>,
    onWorkAvailable: () => void
  ): {identity: NativeIdentity; closed: Promise<NativeRuntimeCloseResult>};
  applyIntent(intent: ReturnType<typeof localIntent>): Promise<void>;
  exchange(): NativeDelivery;

  setCapacity(capacity: HostCapacity | null): void;
  incomingTerminal(handle: IncomingHandle, action: number, status?: number, message?: Uint8Array): void;
  incomingRelease(handle: IncomingHandle): void;
  incomingRespond(handle: IncomingHandle, data: Uint8Array, context: NativeForkEntry): Promise<void>;
  requestPull(handle: IncomingHandle): void;
  close(): void;
}

test("incoming tokens reject malformed handles and stale slot generations", async () => {
  const {closedBy, drainUntil, networkBindings: exports} = await import("./utils/network-bindings.js");
  const {NativeNetworkRuntime} = exports as unknown as {NativeNetworkRuntime: new () => DirectIncomingBridge};
  const config = applicationConfig();
  config.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
  config.identitySecretKey[31] = 2;
  const clientConfig = applicationConfig();
  clientConfig.resources.bridgeBudgetBytes = 512 * 1024 * 1024;
  const client = await startPeer(clientConfig);
  const native = new NativeNetworkRuntime();
  const promises = native.initialize(config, () => undefined);
  try {
    const [, identity] = await Promise.all([client.identity, promises.identity]);
    const intent = native.applyIntent(localIntent(config));
    await client.applyIntent(localIntent(clientConfig));
    await drainUntil(native, intent);
    await client.connect(identity.peerId, [identity.localEndpoint], 5000n);
    let previous: IncomingHandle | undefined;
    for (let i = 0; i < 2; i++) {
      const stream = client.request(identity.peerId, BLOCKS, new Uint8Array(32));
      const pending = stream.next();
      void pending.catch(() => undefined);
      let incoming: IncomingDescriptor | null = null;
      await expect
        .poll(
          () => {
            // Peer events are taken too, so nothing waits.
            native.setCapacity(gossipAll);
            incoming = native.exchange().serving[0] ?? null;
            return incoming !== null;
          },
          {timeout: 5000}
        )
        .toBe(true);
      if (!incoming) throw Error("missing incoming descriptor");
      const descriptor = incoming as IncomingDescriptor;
      const handle = descriptor.handle;
      for (const invalid of [{...handle, index: -1}])
        expect(() => native.incomingTerminal(invalid, 2, undefined, undefined)).toThrow("InvalidNetworkInteger");
      expect(() => native.requestPull(handle)).toThrow();
      if (previous) {
        const responded = native.incomingRespond(handle, new Uint8Array(4000), requestForks[0]);
        expect(handle.index).toBe(previous.index);
        expect(handle.generation).toBe(previous.generation + 1n);
        const stale = previous;
        expect(() => native.incomingTerminal(stale, 2, undefined, undefined)).toThrow("NetworkIncomingClosed");
        await drainUntil(native, responded);
        expect((await pending).done).toBe(false);
      }
      native.incomingTerminal(handle, 0, undefined, undefined);
      await drainUntil(native, descriptor.closed);
      native.incomingRelease(handle);
      await expect
        .poll(() => {
          try {
            native.incomingRelease(handle);
            return null;
          } catch (error) {
            return error;
          }
        })
        .toMatchObject({code: "NetworkIncomingClosed"});
      const done = previous ? stream.next() : pending;
      expect((await done).done).toBe(true);
      previous = handle;
    }
  } finally {
    await Promise.all([client.stop(), closedBy(native, promises.closed)]);
  }
}, 15000);
