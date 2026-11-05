import assert from "node:assert/strict";
import {RPC} from "@libp2p/gossipsub/message";
import {multiaddr} from "@multiformats/multiaddr";
import {decode, encode} from "it-length-prefixed";
import {compressSync, uncompressSync} from "snappy";
import {RPC_MAX, TOPIC, loopback, messageId, payload, prefix, sendFragments, summary} from "./codec.mjs";

export class RawGossip {
  constructor(node, protocols, emit) {
    this.node = node;
    this.protocols = protocols;
    this.emit = emit;
    this.outbound = null;
    this.readers = 0;
    this.frames = 0;
    this.bytes = 0;
  }

  async incoming(stream) {
    assert(this.readers < 1, "raw reader bound");
    this.readers++;
    try {
      await stream.close({signal: AbortSignal.timeout(10000)});
      for await (const frame of decode(stream, {maxDataLength: RPC_MAX})) {
        assert(++this.frames <= 128, "raw RPC count bound");
        this.bytes += frame.byteLength;
        assert(this.bytes <= 4 * RPC_MAX, "raw RPC aggregate bound");
        const rpc = RPC.decode(frame);
        const ids = (values) =>
          values.flatMap((value) => value.messageIDs.map((id) => Buffer.from(id).toString("hex")));
        this.emit({
          event: "rawRpc",
          ihave: ids(rpc.control?.ihave ?? []),
          iwant: ids(rpc.control?.iwant ?? []),
          messages: rpc.messages.map((message) => {
            const data = uncompressSync(message.data);
            return {
              ...summary(data),
              messageId: messageId(message.topic, data, true, true).toString("hex"),
              topic: message.topic,
            };
          }),
          subscriptions: rpc.subscriptions.filter((value) => value.subscribe).map((value) => value.topic),
        });
      }
    } catch (error) {
      this.emit({error: String(error).slice(0, 256), event: "rawClosed"});
    } finally {
      this.readers--;
    }
  }

  async open(address) {
    if (this.outbound) this.outbound.abort(Error("raw stream replacement"));
    this.outbound = await this.node.dialProtocol(multiaddr(loopback(address)), this.protocols, {
      signal: AbortSignal.timeout(10000),
    });
    await this.send({subscriptions: [{subscribe: true, topic: TOPIC}]});
    return {protocol: this.outbound.protocol};
  }

  async send(rpc) {
    assert(this.outbound, "raw stream absent");
    const frame = encode.single(RPC.encode(rpc), {maxDataLength: RPC_MAX}).subarray();
    await sendFragments(this.outbound, frame, AbortSignal.timeout(10000));
  }

  async command(command) {
    if (command.kind === "invalidEnvelope" || command.kind === "extensionEnvelope") {
      const suffix = {
        duplicateControl: [26, 0, 26, 0],
        group: [11, 12],
        noncanonicalTag: [154, 0, 0],
        unknownField: [32, 0],
        wrongWire: [8, 0],
      }[command.kind === "extensionEnvelope" ? "unknownField" : command.variant];
      assert(suffix, "unknown envelope variant");
      const unsubscribe = RPC.encode({subscriptions: [{subscribe: false, topic: TOPIC}]}).subarray();
      const body = Buffer.concat([unsubscribe, Buffer.from(suffix)]);
      await sendFragments(this.outbound, Buffer.concat([prefix(body.length), body]), AbortSignal.timeout(10000));
      return {sent: true};
    }
    if (command.kind === "oversize") {
      await sendFragments(this.outbound, prefix(RPC_MAX + 1), AbortSignal.timeout(10000));
      return {sent: true};
    }
    const data = payload(command.size ?? 64, command.seed ?? 0x71000001);
    const id = messageId(TOPIC, data, true, true);
    let rpc;
    switch (command.kind) {
      case "subscribe":
      case "unsubscribe":
        rpc = {subscriptions: [{subscribe: command.kind === "subscribe", topic: TOPIC}]};
        break;
      case "graft":
        rpc = {control: {graft: [{topicID: TOPIC}]}};
        break;
      case "prune":
        rpc = {control: {prune: [{backoff: 60, topicID: TOPIC}]}};
        break;
      case "ihave":
        rpc = {control: {ihave: [{messageIDs: [id], topicID: TOPIC}]}};
        break;
      case "badId":
        rpc = {control: {ihave: [{messageIDs: [Buffer.alloc(21, 9)], topicID: TOPIC}]}};
        break;
      case "iwant":
        rpc = {control: {iwant: [{messageIDs: [id]}]}};
        break;
      case "publish":
        rpc = {messages: [{data: compressSync(data), topic: TOPIC}]};
        break;
      case "two":
        rpc = {
          messages: [data, payload(command.size, command.seed + 1)].map((bytes) => ({
            data: compressSync(bytes),
            topic: TOPIC,
          })),
        };
        break;
      default:
        throw Error("unknown raw RPC kind");
    }
    await this.send(rpc);
    return {...summary(data), messageId: id.toString("hex")};
  }
}
