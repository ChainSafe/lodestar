import assert from "node:assert/strict";
import {quic} from "@chainsafe/libp2p-quic";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import {StrictNoSign, gossipsub} from "@libp2p/gossipsub";
import {RPC} from "@libp2p/gossipsub/message";
import {identify} from "@libp2p/identify";
import {multiaddr} from "@multiformats/multiaddr";
import {encode} from "it-length-prefixed";
import {createLibp2p} from "libp2p";
import {compressSync, uncompressSync} from "snappy";
import {boundedLines} from "./bounded_lines.mjs";
import {
  BLOCKS,
  MAX,
  PING,
  RPC_MAX,
  TOPIC,
  encodePayload,
  loopback,
  messageId,
  payload,
  prefix,
  rangeRequest,
  readPayload,
  sendFragments,
  summary,
} from "./codec.mjs";
import {ControlHandler} from "./control_handler.mjs";
import {controlProtocols} from "./control_wire.mjs";
import {RawGossip} from "./raw_gossip.mjs";

const lineMax = 65536;
const commandMax = 1024;
const pendingMax = 32;
const eventMax = 1024;
const version = process.argv[2] === "v11" ? "v11" : "v12";
const protocols = version === "v11" ? ["/meshsub/1.1.0"] : ["/meshsub/1.2.0", "/meshsub/1.1.0"];
const phase0 = new Set([TOPIC]);
const rawMode = process.argv[3] === "raw-gossip";
const control =
  process.argv[3] === "control"
    ? new ControlHandler(process.argv[4] ? Buffer.from(process.argv[4], "hex") : undefined)
    : null;
let rawGossip;
let partialStream;
let partialTerminal = null;
let partialBytes = 0;
let holdFin = false;
let heldResponse = null;
let heldTimer;
let holdExpired = false;
let finishCalls = 0;
const messages = [];
let node;
let commands = 0;
let active = 0;

function emit(value) {
  const text = JSON.stringify(value);
  assert(text.length <= lineMax, "output bound");
  process.stdout.write(`${text}\n`);
}

function idFor(message) {
  return messageId(message.topic, message.data, true, phase0.has(message.topic));
}

function validCommand(value) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert(Number.isInteger(value.id) && value.id > 0 && value.id <= 0x7fffffff);
  assert(typeof value.op === "string" && value.op.length > 0 && value.op.length <= 32);
  return value;
}

async function* chunks(stream) {
  let count = 0;
  let bytes = 0;
  for await (const part of stream) {
    const value = part.subarray();
    count += 1;
    bytes += value.length;
    assert(count <= 32768 && bytes <= RPC_MAX + 32, "stream bound");
    yield value;
  }
}

async function respond(stream) {
  const request = await readPayload(chunks(stream));
  const isPing = stream.protocol === PING;
  assert(isPing || stream.protocol === BLOCKS, "request protocol");
  assert.deepEqual(request.bytes, isPing ? Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]) : rangeRequest());
  const response = isPing ? Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]) : payload(MAX, 0x6d2b79f5);
  const header = isPing ? Buffer.from([0]) : Buffer.from([0, 1, 0, 0, 0]);
  await sendFragments(stream, Buffer.concat([header, encodePayload(response, false)]), AbortSignal.timeout(30000));
  if (holdFin) {
    assert(heldResponse === null, "held response bound");
    heldResponse = stream;
    heldTimer = setTimeout(() => {
      holdExpired = true;
      stream.abort(Error("response FIN hold expired"));
    }, 10000);
  } else {
    finishCalls++;
    await stream.close({signal: AbortSignal.timeout(30000)});
  }
}

async function createPeer() {
  const secret = Buffer.alloc(32);
  secret[31] = version === "v11" ? 42 : 41;
  node = await createLibp2p({
    addresses: {listen: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
    connectionGater: {denyDialMultiaddr: async (address) => !address.toString().startsWith("/ip4/127.0.0.1/")},
    privateKey: privateKeyFromRaw(secret),
    services: rawMode
      ? {}
      : {
          identify: identify(),
          pubsub: (components) => {
            const service = gossipsub({
              D: 8,
              // biome-ignore lint/style/useNamingConvention: js-libp2p publishes this option spelling.
              Dhi: 12,
              // biome-ignore lint/style/useNamingConvention: js-libp2p publishes this option spelling.
              Dlazy: 6,
              // biome-ignore lint/style/useNamingConvention: js-libp2p publishes this option spelling.
              Dlo: 6,
              dataTransform: {
                inboundTransform: (_topic, data) => uncompressSync(data),
                outboundTransform: (_topic, data) => compressSync(data),
              },
              floodPublish: false,
              globalSignaturePolicy: StrictNoSign,
              heartbeatInterval: 700,
              maxInboundDataLength: RPC_MAX,
              maxOutboundBufferSize: RPC_MAX + 10,
              mcacheGossip: 3,
              mcacheLength: 6,
              msgIdFn: idFor,
            })(components);
            service.protocols = [...protocols];
            return service;
          },
        },
    start: false,
    transports: [quic()],
  });
  await node.handle(control ? [BLOCKS] : [PING, BLOCKS], respond, {maxInboundStreams: 8});
  if (control) await node.handle(controlProtocols, (stream) => control.respond(stream), {maxInboundStreams: 8});
  if (rawMode) {
    rawGossip = new RawGossip(node, protocols, emit);
    await node.handle(protocols, (stream) => rawGossip.incoming(stream), {maxInboundStreams: 1});
  } else
    node.services.pubsub.addEventListener("message", (event) => {
      if (messages.length < eventMax) {
        const value = {
          messageId: idFor({data: event.detail.data, topic: event.detail.topic}).toString("hex"),
          topic: event.detail.topic,
          ...summary(event.detail.data),
        };
        messages.push(value);
        emit({event: "message", ...value});
      }
    });
  await node.start();
  assert.deepEqual(
    node
      .getProtocols()
      .filter((item) => item.startsWith("/meshsub/"))
      .sort(),
    [...protocols].sort()
  );
}

async function request(address, large, retire) {
  const signal = AbortSignal.timeout(large ? 30000 : 10000);
  const stream = await node.dialProtocol(multiaddr(loopback(address)), large ? BLOCKS : PING, {signal});
  let received = 0;
  async function* observed() {
    for await (const part of chunks(stream)) {
      received += part.length;
      yield part;
    }
  }
  const result = readPayload(observed(), true, large).catch((error) => {
    throw Error(`${error.message}; received=${received}`);
  });
  const bytes = large ? rangeRequest() : Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]);
  await sendFragments(stream, encodePayload(bytes, false), signal);
  await stream.close({signal});
  const decoded = await result;
  assert.equal(decoded.result, 0);
  if (retire) stream.abort(Error("configured final chunk consumed"));
  return {...summary(decoded.bytes), context: decoded.context, retired: retire ? stream.status !== "open" : undefined};
}

async function rawPublish(address, seed, size) {
  const signal = AbortSignal.timeout(30000);
  const stream = await node.dialProtocol(multiaddr(loopback(address)), protocols, {signal});
  const data = payload(size, seed);
  const bytes = encode
    .single(RPC.encode({messages: [{data: compressSync(data), topic: TOPIC}]}), {maxDataLength: RPC_MAX})
    .subarray();
  await sendFragments(stream, bytes, signal);
  await stream.close({signal});
  return summary(data);
}

async function execute(command) {
  switch (command.op) {
    case "control":
      assert(control);
      return control.request(node, command.address, command.protocol);
    case "bumpSequence":
      assert(control);
      control.sequence++;
      return {sequence: control.sequence.toString()};
    case "controlSnapshot":
      assert(control);
      return {counts: control.counts, failures: control.failures, priorFin: control.priorFin};
    case "holdFin":
      holdFin = true;
      holdExpired = false;
      return {held: true};
    case "releaseFin":
      assert(heldResponse && !holdExpired, "response hold expired or absent");
      clearTimeout(heldTimer);
      finishCalls++;
      if (heldResponse.status === "open") await heldResponse.close({signal: AbortSignal.timeout(1000)});
      heldResponse = null;
      holdFin = false;
      return {released: true};
    case "rawOpen":
      assert(rawMode);
      return rawGossip.open(command.address);
    case "rawRpc":
      assert(rawMode);
      return rawGossip.command(command);
    case "partialStart": {
      assert(!partialStream, "one partial request maximum");
      partialStream = await node.dialProtocol(multiaddr(loopback(command.address)), PING, {
        signal: AbortSignal.timeout(10000),
      });
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        partialStream.abort(Error("partial observation timeout"));
      }, 10000);
      const observe = async () => {
        try {
          for await (const part of chunks(partialStream)) partialBytes += part.length;
          partialTerminal = "eof";
        } catch {
          partialTerminal = controller.signal.aborted ? "deadline" : "reset";
        } finally {
          clearTimeout(timer);
          partialStream.abort(Error("partial observation finished"));
        }
      };
      void observe();
      await sendFragments(partialStream, encodePayload(Buffer.alloc(8)).subarray(0, 2), AbortSignal.timeout(10000));
      return {open: true};
    }
    case "partialStatus":
      return {bytes: partialBytes, terminal: partialTerminal};
    case "malformedRequest": {
      const signal = AbortSignal.timeout(10000);
      const stream = await node.dialProtocol(multiaddr(loopback(command.address)), BLOCKS, {signal});
      const source = chunks(stream);
      const response = readPayload(source, true);
      await sendFragments(stream, prefix(MAX + 1), signal);
      await stream.close({signal});
      const decoded = await response;
      const end = await source.next();
      assert(end.done, "invalid-request trailing bytes");
      return {fin: end.done, result: decoded.result, ...summary(decoded.bytes)};
    }
    case "listen":
      return {address: loopback(node.getMultiaddrs()[0].toString()), protocols};
    case "dial":
      loopback(command.address);
      {
        const connection = await node.dial(multiaddr(command.address), {signal: AbortSignal.timeout(10000)});
        return {
          connections: node.getConnections().length,
          remotePeer: connection.remotePeer.toString(),
          status: connection.status,
        };
      }
    case "subscribe":
      node.services.pubsub.subscribe(command.topic ?? TOPIC);
      return {subscribers: node.services.pubsub.getSubscribers(command.topic ?? TOPIC).length};
    case "publish": {
      const size = command.size ?? 65537;
      assert(Number.isInteger(size) && size >= 0 && size <= MAX);
      await node.services.pubsub.publish(command.topic ?? TOPIC, payload(size, command.seed ?? 0x6d2b79f5));
      return {size};
    }
    case "request":
      return request(command.address, command.large === true, command.retire === true);
    case "rawPublish":
      return rawPublish(command.address, command.seed ?? 0x6d2b79f5, command.size ?? MAX);
    case "snapshot":
      return {
        connections: node.getConnections().length,
        finishCalls,
        heldFin: heldResponse !== null && !holdExpired,
        messages: messages.length,
        protocols,
        reqrespOutbound: node
          .getConnections()
          .flatMap((connection) => connection.streams)
          .filter(
            (stream) =>
              stream.direction === "outbound" && stream.status === "open" && [PING, BLOCKS].includes(stream.protocol)
          ).length,
        subscribers: rawMode ? 0 : node.services.pubsub.getSubscribers(command.topic ?? TOPIC).length,
      };
    case "disconnect":
      await Promise.allSettled(node.getConnections().map((connection) => connection.close()));
      return {connections: node.getConnections().length};
    case "ids":
      return {
        altair: messageId(TOPIC, Buffer.from("hello")).toString("hex"),
        invalid: messageId(TOPIC, Buffer.from([255]), false).toString("hex"),
        other: messageId(TOPIC.replace("beacon_block", "voluntary_exit"), Buffer.from("hello")).toString("hex"),
        phase0: messageId(TOPIC, Buffer.from("hello"), true, true).toString("hex"),
        phase0Other: messageId(
          TOPIC.replace("beacon_block", "voluntary_exit"),
          Buffer.from("hello"),
          true,
          true
        ).toString("hex"),
      };
    case "shutdown":
      clearTimeout(heldTimer);
      await node.stop();
      return {shutdown: true};
    default:
      throw Error("unknown operation");
  }
}

await createPeer();
try {
  for await (const line of boundedLines(process.stdin, lineMax)) {
    if (line.length > lineMax || ++commands > commandMax) break;
    let command;
    try {
      command = validCommand(JSON.parse(line));
      assert(++active <= pendingMax, "pending bound");
      const result = await execute(command);
      emit({id: command.id, ok: true, ...result});
      active -= 1;
      if (command.op === "shutdown") break;
    } catch (error) {
      active = Math.max(0, active - 1);
      emit({error: error instanceof Error ? error.message : "invalid command", id: command?.id ?? 0, ok: false});
    }
  }
} finally {
  if (node?.status === "started") await node.stop();
}
