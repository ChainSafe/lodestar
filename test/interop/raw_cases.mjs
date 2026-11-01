import assert from "node:assert/strict";
import {TOPIC, messageId, payload, summary} from "./codec.mjs";

function transient(snapshot) {
  return (
    snapshot.gossipDescriptors === 0 &&
    snapshot.gossipQueuedBytes === 0 &&
    snapshot.heldFrames === 0 &&
    snapshot.pendingValidations === 0 &&
    snapshot.promises === 0
  );
}

export async function exerciseRaw(Child, waitFor, binary) {
  const zig = new Child("zig-raw", binary, []);
  const js = new Child("js-raw", process.execPath, [
    "--max-old-space-size=256",
    "test/interop/libp2p_peer.mjs",
    "v12",
    "raw-gossip",
  ]);
  const rawEvents = () => js.events.filter((event) => event.event === "rawRpc");
  const deliveries = () => zig.events.filter((event) => event.event === "message");
  const countId = (field, id) =>
    rawEvents()
      .flatMap((event) => event[field])
      .filter((value) => value === id).length;
  async function fresh(seed) {
    const ping = await js.command("request", {address: address.address});
    assert.equal(ping.length, 8);
    const expected = summary(payload(64, seed));
    await js.command("rawRpc", {kind: "publish", seed, size: 64});
    await waitFor(() => deliveries().filter((event) => event.sha256 === expected.sha256).length === 1);
    assert.equal((await zig.command("snapshot")).connectionGeneration, generation);
  }
  async function cleanStore() {
    await waitFor(async () => transient(await zig.command("snapshot")));
    for (let i = 0; i < 6; i++) {
      await zig.command("advance", {ms: 700});
      await zig.command("pump", {turns: 8});
    }
    await waitFor(async () => {
      const snapshot = await zig.command("snapshot");
      return transient(snapshot) && snapshot.storeEntries === 0 && snapshot.storePages === 0;
    });
  }
  let address;
  let generation;
  try {
    address = await zig.command("listen");
    await zig.command("subscribe", {topic: TOPIC});
    await js.command("rawOpen", {address: address.address});
    await waitFor(() => rawEvents().some((event) => event.subscriptions.includes(TOPIC)));
    await js.command("rawRpc", {kind: "graft"});
    await waitFor(async () => (await zig.command("snapshot")).meshMembers === 1);
    generation = (await zig.command("snapshot")).connectionGeneration;

    const recovered = payload(65537, 0x71000101);
    const recoveryId = messageId(TOPIC, recovered, true, true).toString("hex");
    await js.command("rawRpc", {kind: "ihave", seed: 0x71000101, size: recovered.length});
    await waitFor(() => countId("iwant", recoveryId) === 1);
    assert.equal((await zig.command("snapshot")).promises, 1);
    await js.command("rawRpc", {kind: "publish", seed: 0x71000101, size: recovered.length});
    await waitFor(() => deliveries().filter((event) => event.sha256 === summary(recovered).sha256).length === 1);
    await waitFor(async () => transient(await zig.command("snapshot")));
    assert.equal(countId("iwant", recoveryId), 1);
    await cleanStore();

    await js.command("rawRpc", {kind: "prune"});
    await waitFor(async () => (await zig.command("snapshot")).meshMembers === 0);
    await js.command("rawRpc", {kind: "unsubscribe"});
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions === 0);
    const cached = payload(65538, 0x71000102);
    const cachedId = messageId(TOPIC, cached, true, true).toString("hex");
    assert.equal((await zig.command("publish", {seed: 0x71000102, size: cached.length})).queued, 0);
    await js.command("rawRpc", {kind: "subscribe"});
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions === 1);
    await zig.command("advance", {ms: 700});
    await waitFor(() => countId("ihave", cachedId) >= 1);
    assert.equal(
      rawEvents()
        .flatMap((event) => event.messages)
        .filter((message) => message.messageId === cachedId).length,
      0
    );
    await js.command("rawRpc", {kind: "iwant", seed: 0x71000102, size: cached.length});
    await waitFor(
      () =>
        rawEvents()
          .flatMap((event) => event.messages)
          .filter((message) => message.messageId === cachedId).length === 1
    );
    assert.deepEqual(
      rawEvents()
        .flatMap((event) => event.messages)
        .find((message) => message.messageId === cachedId),
      {
        ...summary(cached),
        messageId: cachedId,
        topic: TOPIC,
      }
    );
    await cleanStore();

    await js.command("partialStart", {address: address.address});
    await waitFor(async () => (await zig.command("snapshot")).reqrespInbound === 1);
    await zig.command("advance", {ms: 5001});
    await waitFor(
      () => zig.events.filter((event) => event.event === "failed" && event.reason === "timeout").length === 1
    );
    await waitFor(async () => ["eof", "reset"].includes((await js.command("partialStatus")).terminal));
    assert.equal((await js.command("partialStatus")).bytes, 0);
    await waitFor(async () => (await zig.command("snapshot")).reqrespInbound === 0);
    await fresh(0x71000105);

    const malformed = (await zig.command("snapshot")).malformedRpcs;
    await js.command("rawRpc", {kind: "oversize"});
    await waitFor(async () => (await zig.command("snapshot")).malformedRpcs === malformed + 1);
    await js.command("rawOpen", {address: address.address});
    await fresh(0x71000106);
    const invalid = await js.command("malformedRequest", {address: address.address});
    assert.equal(invalid.result, 1);
    assert.equal(invalid.fin, true);
    await waitFor(async () => (await zig.command("snapshot")).reqrespInbound === 0);
    await fresh(0x71000107);
    const controlBefore = rawEvents().flatMap((event) => event.iwant).length;
    const errorsBefore = (await zig.command("snapshot")).malformedRpcs;
    await js.command("rawRpc", {kind: "badId"});
    await waitFor(async () => (await zig.command("snapshot")).malformedRpcs === errorsBefore + 1);
    await js.command("rawOpen", {address: address.address});
    await fresh(0x71000108);
    assert.equal(rawEvents().flatMap((event) => event.iwant).length, controlBefore);
    assert.equal((await zig.command("snapshot")).malformedRpcs, errorsBefore + 1);
    for (const variant of ["duplicateControl", "group", "noncanonicalTag", "wrongWire"]) {
      const prior = await zig.command("snapshot");
      assert.equal(prior.remoteSubscriptions, 1);
      await js.command("rawRpc", {kind: "invalidEnvelope", variant});
      await waitFor(async () => (await zig.command("snapshot")).malformedRpcs === prior.malformedRpcs + 1);
      const rejected = await zig.command("snapshot");
      assert.equal(rejected.remoteSubscriptions, prior.remoteSubscriptions, "invalid RPC applied its valid prefix");
      assert.equal(rejected.connectionGeneration, generation);
      assert.equal(rejected.heldFrames, 0);
      await js.command("rawOpen", {address: address.address});
    }
    const beforeExtension = await zig.command("snapshot");
    await js.command("rawRpc", {kind: "extensionEnvelope"});
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions === 0);
    assert.equal((await zig.command("snapshot")).malformedRpcs, beforeExtension.malformedRpcs);
    await js.command("rawRpc", {kind: "subscribe"});
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions === 1);
    await cleanStore();
    assert.equal(countId("iwant", recoveryId), 1);
    assert.equal(
      rawEvents()
        .flatMap((event) => event.messages)
        .filter((message) => message.messageId === cachedId).length,
      1
    );
    assert.equal(deliveries().length, 5);
    return {malformed: true, recovery: true, timeout: true};
  } catch (error) {
    throw Error(
      `raw scenarios: ${String(error)} ${JSON.stringify({js: js.events.slice(-12), snapshot: await zig.command("snapshot").catch(() => null), zig: zig.events.slice(-12)})}`
    );
  } finally {
    await Promise.allSettled([zig.stop(), js.stop()]);
  }
}
