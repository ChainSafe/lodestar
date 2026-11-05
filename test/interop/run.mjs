import assert from "node:assert/strict";
import {Child, verifyExecutable, waitFor} from "./child.mjs";
import {MAX, TOPIC, payload, summary} from "./codec.mjs";
import {exerciseRaw} from "./raw_cases.mjs";

function assertIds(ids) {
  assert.equal(ids.phase0, "79d62a59d0e47597aeb73cb85ba034c3f67f90e8");
  assert.equal(ids.phase0Other, ids.phase0);
  assert.equal(ids.altair, "e79e947290cd1ce340628caac5541294e6702329");
  assert.equal(ids.invalid, "a4836ac28360e4a1514db96802f612887409b735");
  assert.equal(ids.other, "ece38723d0a2c13e368a1f88a9eb881f68145a30");
}

function quiescent(snapshot) {
  return (
    snapshot.connections === 0 &&
    snapshot.streams === 0 &&
    snapshot.negotiations === 0 &&
    snapshot.gossipPeers === 0 &&
    snapshot.gossipDescriptors === 0 &&
    snapshot.gossipQueuedBytes === 0 &&
    snapshot.heldFrames === 0 &&
    snapshot.meshMembers === 0 &&
    snapshot.pendingValidations === 0 &&
    snapshot.promises === 0 &&
    snapshot.remoteSubscriptions === 0 &&
    snapshot.reqrespInbound === 0 &&
    snapshot.reqrespOutbound === 0 &&
    snapshot.storeEntries === 0 &&
    snapshot.storePages === 0
  );
}

async function reclaim(zig, deadline) {
  for (let heartbeat = 0; heartbeat < 6; heartbeat++) {
    await zig.command("advance", {ms: 700});
    await zig.command("pump", {turns: 8});
  }
  await waitFor(async () => quiescent(await zig.command("snapshot")), Math.max(1, deadline - Date.now()));
}

async function exercise(version, binary, zigDials = false) {
  const zig = new Child("zig", binary, []);
  const js = new Child("js", process.execPath, ["--max-old-space-size=256", "test/interop/libp2p_peer.mjs", version]);
  const expectedMessages = [];
  async function delivered(child, size, seed) {
    const expected = summary(payload(size, seed));
    expectedMessages.push({child, expected});
    await waitFor(
      () => child.events.filter((event) => event.event === "message" && event.sha256 === expected.sha256).length === 1,
      30000
    );
    const message = child.events.find((event) => event.event === "message" && event.sha256 === expected.sha256);
    assert.equal(message.length, size);
  }
  try {
    const [zigListen, jsListen, zigIds, jsIds] = await Promise.all([
      zig.command("listen"),
      js.command("listen"),
      zig.command("ids"),
      js.command("ids"),
    ]);
    assertIds(zigIds);
    assertIds(jsIds);
    if (zigDials) {
      await zig.command("dial", {address: jsListen.address});
      await waitFor(async () => (await js.command("snapshot")).connections === 1);
    } else {
      await js.command("dial", {address: zigListen.address});
      await waitFor(async () => (await zig.command("snapshot")).connections === 1);
    }
    let previousConnection = await zig.command("snapshot");
    assert.equal(previousConnection.connectionDirection, zigDials ? "outbound" : "inbound");
    const jsPing = await js.command("request", {address: zigListen.address});
    assert.deepEqual({length: jsPing.length, sha256: jsPing.sha256}, summary(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])));
    await zig.command("request");
    await waitFor(() => zig.events.some((event) => event.event === "chunk" && event.length === 8));
    const zigPing = zig.events.find((event) => event.event === "chunk" && event.length === 8);
    assert.equal(zigPing.sha256, jsPing.sha256);
    if (version === "v12") {
      await assert.rejects(zig.command("respond", {seed: 1, size: MAX + 1}), /MessageTooLarge/);
      const zigFinBefore = (await zig.command("snapshot")).finishCalls;
      await zig.command("holdFin", {paused: true});
      let jsLarge;
      try {
        jsLarge = await js.command("request", {address: zigListen.address, large: true, retire: true}, 30000);
      } catch (error) {
        throw Error(
          `js large request ${String(error)} ${JSON.stringify({jsEvents: js.events.slice(-8), zigEvents: zig.events.slice(-8), zigStderr: zig.stderr})}`
        );
      }
      assert.deepEqual({length: jsLarge.length, sha256: jsLarge.sha256}, summary(payload(MAX)));
      assert.equal(jsLarge.context, "01000000");
      assert.equal(jsLarge.retired, true);
      await waitFor(async () => (await zig.command("snapshot")).heldFin, 2000);
      assert.equal((await zig.command("snapshot")).finishCalls, zigFinBefore);
      assert.equal((await js.command("snapshot")).reqrespOutbound, 0);
      await zig.command("releaseFin");
      const jsFinBefore = (await js.command("snapshot")).finishCalls;
      await js.command("holdFin");
      await zig.command("request", {large: true}, 30000);
      await waitFor(() => zig.events.some((event) => event.event === "chunk" && event.length === MAX), 30000);
      const large = zig.events.find((event) => event.event === "chunk" && event.length === MAX);
      assert.equal(large.sha256, jsLarge.sha256);
      assert.equal(large.context, "01000000");
      await waitFor(() => zig.events.filter((event) => event.event === "done").length === 2, 2000);
      await waitFor(async () => (await zig.command("snapshot")).reqrespOutbound === 0, 2000);
      assert.equal((await js.command("snapshot")).heldFin, true);
      assert.equal((await js.command("snapshot")).finishCalls, jsFinBefore);
      await js.command("releaseFin");
    }
    if (process.argv[3] === "--fin-only") return {earlyRetirement: true};
    await Promise.all([zig.command("subscribe", {topic: TOPIC}), js.command("subscribe", {topic: TOPIC})]);
    await waitFor(async () => (await js.command("snapshot", {topic: TOPIC})).subscribers > 0);
    await js.command("publish", {seed: 0x6d2b79f5, size: 65537, topic: TOPIC});
    await delivered(zig, 65537, 0x6d2b79f5);
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions > 0);
    await waitFor(async () => (await zig.command("snapshot")).meshMembers > 0);
    const selected = await zig.command("snapshot");
    assert.equal(selected.connections, 1);
    assert.equal(selected.hasInboundStream, true);
    assert.equal(selected.outboundVersion, version === "v11" ? "v1_1" : "v1_2");
    assert.equal(new Set(zig.events.filter((event) => event.event === "connected").map((event) => event.peer)).size, 1);
    const zigPublish = await zig.command("publish", {seed: 0x6d2b79f7, size: 65537, topic: TOPIC});
    assert(zigPublish.queued > 0, "Zig publish had no mesh recipient");
    let zigAfterPublish;
    let jsAfterPublish;
    try {
      await waitFor(async () => {
        zigAfterPublish = await zig.command("snapshot");
        jsAfterPublish = await js.command("snapshot");
        return js.events.some((event) => event.event === "message" && event.length === 65537);
      }, 10000);
    } catch {
      throw Error(`zig to js gossip timeout ${JSON.stringify({jsAfterPublish, zigAfterPublish})}`);
    }
    await delivered(js, 65537, 0x6d2b79f7);
    for (const [size, seed] of [
      [32 * 1024 + 1, 0x6d2b7a01],
      [2 * 1024 * 1024 + 1, 0x6d2b7a02],
    ]) {
      await js.command("publish", {seed, size, topic: TOPIC});
      await delivered(zig, size, seed);
      const published = await zig.command("publish", {seed: seed + 2, size, topic: TOPIC});
      assert(published.queued > 0, `Zig ${size} gossip had no mesh recipient`);
      await delivered(js, size, seed + 2);
    }
    if (version === "v12") {
      await js.command("rawPublish", {address: zigListen.address, seed: 0x6d2b7a03, size: MAX}, 30000);
      await delivered(zig, MAX, 0x6d2b7a03);
      const published = await zig.command("publish", {seed: 0x6d2b7a04, size: MAX, topic: TOPIC}, 30000);
      assert(published.queued > 0, "Zig exact gossip had no mesh recipient");
      await delivered(js, MAX, 0x6d2b7a04);
    }
    await assert.rejects(zig.command("publish", {size: MAX + 1}), /MessageTooLarge/);
    await assert.rejects(js.command("publish", {size: MAX + 1}), /false|assert/i);
    if (version === "v12") {
      const reconnectDeadline = Date.now() + 30000;
      for (let cycle = 0; cycle < 8; cycle++) {
        const closed = await js.command("disconnect");
        assert.equal(closed.connections, 0, `reconnect ${cycle} disconnect retained JS connection`);
        await waitFor(
          async () => (await js.command("snapshot")).connections === 0,
          Math.max(1, reconnectDeadline - Date.now())
        );
        await reclaim(zig, reconnectDeadline);
        const redial = zigDials
          ? await zig.command("dial", {address: jsListen.address})
          : await js.command("dial", {address: zigListen.address});
        await waitFor(async () => (await js.command("snapshot")).connections === 1);
        try {
          await waitFor(
            async () => (await zig.command("snapshot")).connections === 1,
            Math.max(1, reconnectDeadline - Date.now())
          );
        } catch (error) {
          throw Error(
            `reconnect ${cycle} ${String(error)} ${JSON.stringify({js: await js.command("snapshot"), redial, zig: await zig.command("snapshot"), zigEvents: zig.events.slice(-12)})}`
          );
        }
        const currentConnection = await zig.command("snapshot");
        assert.equal(currentConnection.connectionDirection, zigDials ? "outbound" : "inbound");
        assert.notDeepEqual(
          [currentConnection.connectionIndex, currentConnection.connectionGeneration],
          [previousConnection.connectionIndex, previousConnection.connectionGeneration]
        );
        previousConnection = currentConnection;
        let ping;
        try {
          ping = await js.command("request", {address: zigListen.address});
        } catch (error) {
          throw Error(
            `reconnect ${cycle} ping ${String(error)} ${JSON.stringify({jsEvents: js.events.slice(-8), jsLate: js.late.slice(-4), zigEvents: zig.events.slice(-12)})}`
          );
        }
        assert.equal(ping.length, 8);
        await waitFor(
          async () => {
            const current = await zig.command("snapshot");
            return current.remoteSubscriptions > 0 && current.meshMembers > 0;
          },
          Math.max(1, reconnectDeadline - Date.now())
        );
        const messages = zig.events.filter((event) => event.event === "message").length;
        await js.command("publish", {seed: 0x6d2b7a00 + cycle, size: 8, topic: TOPIC});
        await waitFor(
          () => zig.events.filter((event) => event.event === "message").length === messages + 1,
          Math.max(1, reconnectDeadline - Date.now())
        );
      }
      await js.command("disconnect");
      await reclaim(zig, reconnectDeadline);
    }
    for (const {child, expected} of expectedMessages) {
      assert.equal(
        child.events.filter((event) => event.event === "message" && event.sha256 === expected.sha256).length,
        1
      );
    }
    return {jsListen, jsPing, zigListen};
  } finally {
    await Promise.allSettled([zig.stop(), js.stop()]);
  }
}

const binary = await verifyExecutable(process.argv[2] ?? "zig-out/bin/network_interop_peer");
if (process.argv[3] === "--fin-only") {
  await exercise("v12", binary);
  console.log(JSON.stringify({earlyRetirement: true, ok: true}));
} else if (process.argv[3] === "--ownership-only") {
  await exercise("v12", binary, true);
  console.log(JSON.stringify({ok: true, ownership: true}));
} else {
  const raw = await exerciseRaw(Child, waitFor, binary);
  if (process.argv[3] === "--raw-only") {
    console.log(JSON.stringify({ok: true, raw}));
  } else {
    const v12 = await exercise("v12", binary);
    await exercise("v12", binary, true);
    const v11 = await exercise("v11", binary);
    await exercise("v11", binary, true);
    console.log(JSON.stringify({ok: true, raw, v11: v11.jsPing, v12: v12.jsPing}));
  }
}
