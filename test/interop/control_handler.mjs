import assert from "node:assert/strict";
import {multiaddr} from "@multiformats/multiaddr";
import {encodePayload, loopback, readPayload, sendFragments} from "./codec.mjs";
import * as wire from "./control_wire.mjs";

export class ControlHandler {
  constructor(forkDigest = Uint8Array.of(1, 2, 3, 4)) {
    assert.equal(forkDigest.length, 4);
    this.forkDigest = forkDigest;
    this.sequence = wire.sequence;
    this.counts = Object.fromEntries(wire.controlProtocols.map((protocol) => [protocol, 0]));
    this.failures = [];
    this.priorFin = 0;
  }
  response(protocol, sequence) {
    const bytes = wire.response(protocol, sequence);
    if (protocol === wire.status1 || protocol === wire.status2) bytes.set(this.forkDigest);
    return bytes;
  }
  async respond(stream) {
    try {
      assert(wire.controlProtocols.includes(stream.protocol));

      if ([wire.metadata1, wire.metadata2, wire.metadata3].includes(stream.protocol)) {
        if (stream.remoteWriteStatus === "closed") this.priorFin++;
        await readEmptyRequest(stream);
      } else {
        const request = await readPayload(stream);
        if (stream.protocol === wire.ping) assert.equal(request.bytes.length, 8);
        else if (stream.protocol === wire.goodbye) assert([1n, 2n, 3n, 128n].includes(request.bytes.readBigUInt64LE()));
        else assert.deepEqual(request.bytes, this.response(stream.protocol));
      }
      this.counts[stream.protocol]++;
      assert(this.counts[stream.protocol] <= 1024, "control request bound");
      await sendFragments(
        stream,
        Buffer.concat([Buffer.from([0]), encodePayload(this.response(stream.protocol, this.sequence))]),
        AbortSignal.timeout(5000)
      );
      await stream.close({signal: AbortSignal.timeout(5000)});
    } catch (error) {
      if (this.failures.length < 16) this.failures.push(String(error));
      stream.abort(error);
    }
  }
  async request(node, address, protocol) {
    assert(wire.controlProtocols.includes(protocol));
    const signal = AbortSignal.timeout(5000);
    const stream = await node.dialProtocol(multiaddr(loopback(address)), protocol, {signal});
    if (![wire.metadata1, wire.metadata2, wire.metadata3].includes(protocol)) {
      const bytes = protocol === wire.goodbye ? wire.uint64(1n) : this.response(protocol);
      await sendFragments(stream, encodePayload(bytes), signal);
    }
    await stream.close({signal});
    const result = await readPayload(stream, true);
    assert.equal(result.result, 0);
    assert.deepEqual(result.bytes, this.response(protocol));
    return {hex: result.bytes.toString("hex"), protocol};
  }
}

export async function readEmptyRequest(stream) {
  assert.equal(stream.readBufferLength, 0, "Metadata must have no encoded request body");
  // FIN can precede handler attachment without changing local readStatus.
  if (stream.remoteWriteStatus === "closed") return;
  const signal = AbortSignal.timeout(5000);
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.removeEventListener("message", message);
      stream.removeEventListener("remoteCloseWrite", finish);
      stream.removeEventListener("close", close);
      signal.removeEventListener("abort", abort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const message = () => fail(Error("Metadata must have no encoded request body"));
    const close = (event) => (event.error ? fail(event.error) : finish());
    const abort = () => fail(signal.reason);
    stream.addEventListener("message", message);
    stream.addEventListener("remoteCloseWrite", finish);
    stream.addEventListener("close", close);
    signal.addEventListener("abort", abort, {once: true});
  });
}
