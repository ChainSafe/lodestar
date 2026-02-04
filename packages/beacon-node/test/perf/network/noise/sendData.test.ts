import {generateKeyPair} from "@libp2p/crypto/keys";
import {Upgrader} from "@libp2p/interface";
import {defaultLogger} from "@libp2p/logger";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import drain from "it-drain";
import {duplexPair} from "it-pair/duplex";
import {pipe} from "it-pipe";
import {Uint8ArrayList} from "uint8arraylist";
import {bench, describe} from "@chainsafe/benchmark";
import {noise} from "@chainsafe/libp2p-noise";

// Type for the duplex-like stream interface used in perf testing
interface DuplexStream {
  source: AsyncIterable<Uint8Array | Uint8ArrayList>;
  sink: (source: AsyncIterable<Uint8Array | Uint8ArrayList>) => Promise<void>;
}

describe("network / noise / sendData", () => {
  const numberOfMessages = 1000;

  for (const messageLength of [
    //
    2 ** 8,
    2 ** 9,
    2 ** 10,
    1200,
    2 ** 11,
    2 ** 12,
    2 ** 14,
    2 ** 16,
  ]) {
    bench({
      id: `send data - ${numberOfMessages} ${messageLength}B messages`,
      beforeEach: async () => {
        const privateKeyA = await generateKeyPair("secp256k1");
        const privateKeyB = await generateKeyPair("secp256k1");
        const peerA = peerIdFromPrivateKey(privateKeyA);
        const peerB = peerIdFromPrivateKey(privateKeyB);
        const upgrader = {getStreamMuxers: () => new Map()} as Upgrader;
        const noiseA = noise()({logger: defaultLogger(), privateKey: privateKeyA, peerId: peerA, upgrader});
        const noiseB = noise()({logger: defaultLogger(), privateKey: privateKeyB, peerId: peerB, upgrader});

        const [inboundConnection, outboundConnection] = duplexPair<Uint8Array | Uint8ArrayList>();
        const [outbound, inbound] = await Promise.all([
          // Cast to any to bypass strict MessageStream type requirements in perf tests
          noiseA.secureOutbound(outboundConnection as any, {remotePeer: peerB}),
          noiseB.secureInbound(inboundConnection as any, {remotePeer: peerA}),
        ]);

        // In libp2p v3, SecuredConnection.connection is a MessageStream
        // Cast to DuplexStream for compatibility with pipe-based perf test
        return {
          connA: outbound.connection as unknown as DuplexStream,
          connB: inbound.connection as unknown as DuplexStream,
          data: new Uint8Array(messageLength),
        };
      },
      fn: async ({connA, connB, data}) => {
        // Create async generator for sending messages
        async function* generateMessages(): AsyncIterable<Uint8Array> {
          for (let i = 0; i < numberOfMessages; i++) {
            yield data;
          }
        }
        await Promise.all([
          //
          pipe(connB.source, connB.sink),
          pipe(generateMessages(), connA.sink),
          pipe(connB.source, drain),
        ]);
      },
    });
  }
});
