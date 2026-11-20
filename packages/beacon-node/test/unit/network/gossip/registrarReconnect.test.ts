import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {expect, it, vi} from "vitest";

type Peer = {toString(): string};
type Connection = {status: "open" | "closed"; id: string};
type Topology = {
  onConnect?(peer: Peer, connection: Connection): void | Promise<void>;
  onDisconnect?(peer: Peer): void | Promise<void>;
};
type Registrar = {register(protocol: string, topology: Topology): Promise<string>};
type Components = {
  peerId: Peer;
  peerStore: {get(peer: Peer): Promise<{protocols: string[]}>};
  events: {addEventListener(type: string, listener: EventListenerOrEventListenerObject): void};
  logger: {forComponent(): unknown};
};
// The pinned dependency has no registrar subpath export. Resolve its actual
// installed runtime so these tests exercise the delivered patch, not a copy.
const {Registrar: RegistrarImpl} = (await import(
  new URL("./registrar.js", pathToFileURL(createRequire(import.meta.url).resolve("libp2p"))).href
)) as {Registrar: new (components: Components) => Registrar};

function fixture(protocols = ["/meshsub/1.2.0"]) {
  const listeners = new Map<string, EventListenerOrEventListenerObject[]>();
  const peer = {toString: () => "existing-peer"};
  const logger = Object.assign(vi.fn(), {error: vi.fn()});
  let read = () => Promise.resolve({protocols});
  const registrar = new RegistrarImpl({
    peerId: peer,
    peerStore: {get: () => read()},
    events: {
      addEventListener(type, listener) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
    },
    logger: {forComponent: () => logger},
  });
  const emit = async (type: string, detail: unknown) => {
    const event = new CustomEvent(type, {detail});
    await Promise.all(
      (listeners.get(type) ?? []).map((listener) =>
        typeof listener === "function" ? listener(event) : listener.handleEvent(event)
      )
    );
  };
  const identify = async (id: string, who: Peer = peer) => {
    await emit("peer:connect", who);
    await emit("peer:identify", {peerId: who, protocols, connection: {status: "open", id}});
  };
  return {
    peer,
    registrar,
    emit,
    identify,
    logger,
    setRead(value: typeof read) {
      read = value;
    },
  };
}

it("does not disconnect a newer identified peer after a deferred old peer-store read", async () => {
  const f = fixture();
  const active = new Set<string>();
  await f.registrar.register("/meshsub/1.2.0", {
    onConnect: (peer) => {
      active.add(peer.toString());
    },
    onDisconnect: (peer) => {
      active.delete(peer.toString());
    },
  });
  await f.identify("old");
  const delayed = Promise.withResolvers<{protocols: string[]}>();
  f.setRead(() => delayed.promise);
  const old = f.emit("peer:disconnect", f.peer);
  await f.identify("new");
  delayed.resolve({protocols: ["/meshsub/1.2.0"]});
  await old;
  expect(active.has(f.peer.toString())).toBe(true);
  expect(f.logger.error).not.toHaveBeenCalled();
});

it("still notifies an ordinary final disconnect", async () => {
  const f = fixture();
  const disconnected = vi.fn();
  await f.registrar.register("/meshsub/1.2.0", {onDisconnect: disconnected});
  await f.identify("old");
  await f.emit("peer:disconnect", f.peer);
  expect(disconnected).toHaveBeenCalledTimes(1);
  expect(f.logger.error).not.toHaveBeenCalled();
});

it("does not continue obsolete protocol cleanup after reconnecting during another callback", async () => {
  const protocols = ["/meshsub/1.1.0", "/meshsub/1.2.0"];
  const f = fixture(protocols);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const active = new Set<string>();
  for (const [index, protocol] of protocols.entries()) {
    await f.registrar.register(protocol, {
      onConnect: () => {
        active.add(protocol);
      },
      onDisconnect: async () => {
        active.delete(protocol);
        if (index === 0) {
          entered.resolve();
          await release.promise;
        }
      },
    });
  }
  await f.identify("old");
  const old = f.emit("peer:disconnect", f.peer);
  await entered.promise;
  await f.identify("new");
  release.resolve();
  await old;
  expect([...active].sort()).toEqual(protocols);
  expect(f.logger.error).not.toHaveBeenCalled();
});

it("does not suppress a different peer's legitimate disconnect", async () => {
  const f = fixture();
  const disconnected: string[] = [];
  await f.registrar.register("/meshsub/1.2.0", {
    onDisconnect: (peer) => {
      disconnected.push(peer.toString());
    },
  });
  await f.identify("old");
  const delayed = Promise.withResolvers<{protocols: string[]}>();
  f.setRead(() => delayed.promise);
  const old = f.emit("peer:disconnect", f.peer);
  await f.identify("unrelated", {toString: () => "other-peer"});
  delayed.resolve({protocols: ["/meshsub/1.2.0"]});
  await old;
  expect(disconnected).toEqual([f.peer.toString()]);
  expect(f.logger.error).not.toHaveBeenCalled();
});

it("does not apply obsolete protocol removals after reconnect", async () => {
  const protocols = ["/meshsub/1.1.0", "/meshsub/1.2.0"];
  const f = fixture(protocols);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const active = new Set<string>();
  for (const [index, protocol] of protocols.entries()) {
    await f.registrar.register(protocol, {
      onConnect: () => {
        active.add(protocol);
      },
      onDisconnect: async () => {
        active.delete(protocol);
        if (index === 0) {
          entered.resolve();
          await release.promise;
        }
      },
    });
  }
  await f.identify("old");
  const old = f.emit("peer:update", {peer: {id: f.peer, protocols: []}, previous: {protocols}});
  await entered.promise;
  await f.identify("new");
  release.resolve();
  await old;
  expect([...active].sort()).toEqual(protocols);
  expect(f.logger.error).not.toHaveBeenCalled();
});
