import assert from "node:assert/strict";
import {Child, verifyExecutable, waitFor} from "./child.mjs";
import * as wire from "./control_wire.mjs";

const binary = await verifyExecutable(process.argv[2] ?? "zig-out/bin/core_interop_peer");
for (const fork of ["phase0", "altair", "fulu"]) {
  const zig = new Child(`core-${fork}`, binary, [fork]);
  const js = new Child("libp2p", process.execPath, [
    "--max-old-space-size=256",
    "test/interop/libp2p_peer.mjs",
    "v12",
    "control",
  ]);
  try {
    const zigAddress = (await zig.command("listen")).address;
    const jsAddress = (await js.command("listen")).address;
    await zig.command("capacity", {capacity: 0});
    await zig.command("dial", {address: jsAddress});
    await waitFor(async () => {
      const state = await zig.command("snapshot");
      return state.relevant === 1 && state.sequence === wire.sequence.toString();
    });
    await zig.command("capacity", {capacity: 1});
    await waitFor(() => zig.events.some((event) => event.event === "ready"));
    const first = await zig.command("snapshot");
    if (fork === "fulu")
      await waitFor(async () => {
        const snapshot = await zig.command("snapshot");
        return snapshot.custody === 4 && snapshot.sampling === 8;
      });
    const expectedStatus = fork === "fulu" ? wire.status2 : wire.status1;
    const expectedMetadata = fork === "fulu" ? wire.metadata3 : fork === "altair" ? wire.metadata2 : wire.metadata1;
    const automatic = await js.command("controlSnapshot");
    assert(automatic.counts[expectedStatus] > 0, "automatic Core Status");
    assert(automatic.counts[expectedMetadata] > 0, "automatic Core Metadata");
    assert.deepEqual(automatic.failures, []);
    for (const protocol of [expectedStatus, wire.metadata1, wire.metadata2, wire.metadata3, wire.ping]) {
      const response = await js.command("control", {address: zigAddress, protocol});
      assert.equal(response.hex, wire.response(protocol).toString("hex"));
    }
    const bumped = await js.command("bumpSequence");
    await waitFor(async () => (await zig.command("snapshot")).sequence === bumped.sequence);
    const refreshed = await js.command("controlSnapshot");
    assert(refreshed.counts[wire.ping] > 0, "automatic Core Ping");
    assert(refreshed.counts[expectedMetadata] >= 2, "automatic sequence-driven refresh");
    await js.command("disconnect");
    await waitFor(async () => (await zig.command("snapshot")).connected === 0);
    await js.command("dial", {address: zigAddress});
    await waitFor(async () => (await zig.command("snapshot")).relevant === 1);
    const second = await zig.command("snapshot");
    assert.notEqual(second.generation, first.generation);
    const ready = zig.events.filter((event) => event.event === "ready");
    assert(ready.length > 0);
    assert(
      zig.events
        .filter((event) => ["ready", "updated"].includes(event.event))
        .every((event) => event.peer === ready[0].peer)
    );
    await zig.command("disconnect");
    await waitFor(async () => (await js.command("controlSnapshot")).counts[wire.goodbye] > 0);
    await waitFor(async () => (await zig.command("snapshot")).connected === 0);
    assert.deepEqual((await js.command("controlSnapshot")).failures, []);
    // A fresh trusted manual dial does not clear the retained remote-Goodbye cooldown.
    // Use a fresh core process for the independently requested uint64 response.
    await zig.command("shutdown");
    await zig.completion;
    const responder = new Child(`goodbye-${fork}`, binary, [fork]);
    try {
      const address = (await responder.command("listen")).address;
      await js.command("control", {address, protocol: wire.goodbye});
      await waitFor(() => responder.events.some((event) => event.event === "closed"));
      await responder.command("shutdown");
      await responder.completion;
    } finally {
      await responder.stop();
    }
    console.log(
      JSON.stringify({
        automaticMetadata: expectedMetadata,
        automaticStatus: expectedStatus,
        fork,
        goodbye: true,
        ok: true,
        reconnect: true,
      })
    );
  } catch (error) {
    await zig.command("capacity", {capacity: 1}).catch(String);
    await waitFor(() => zig.events.length > 0, 1000).catch(String);
    console.error(
      JSON.stringify({
        events: zig.events,
        fork,
        js: await js.command("controlSnapshot").catch(String),
        stderr: zig.stderr,
        zig: await zig.command("snapshot").catch(String),
      })
    );
    throw error;
  } finally {
    await Promise.allSettled([zig.stop(), js.stop()]);
  }
}
