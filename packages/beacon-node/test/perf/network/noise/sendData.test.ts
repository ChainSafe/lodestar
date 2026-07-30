import {generateKeyPair} from "@libp2p/crypto/keys";
import type {Upgrader} from "@libp2p/interface";
import {defaultLogger} from "@libp2p/logger";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {streamPair} from "@libp2p/utils";
import {bench, describe} from "@chainsafe/benchmark";
import {noise} from "@chainsafe/libp2p-noise";

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

        const [outboundConnection, inboundConnection] = await streamPair();
        const [outbound, inbound] = await Promise.all([
          noiseA.secureOutbound(outboundConnection, {remotePeer: peerB}),
          noiseB.secureInbound(inboundConnection, {remotePeer: peerA}),
        ]);

        return {connA: outbound.connection, connB: inbound.connection, data: new Uint8Array(messageLength)};
      },
      fn: async ({connA, connB, data}) => {
        const expectedBytes = numberOfMessages * messageLength;

        // Receiver: drain decrypted plaintext until every expected byte has arrived, then stop
        // reading. Breaking out *before* teardown is what keeps this race-free: @libp2p/utils@7.2.x
        // surfaces connA.close() to the peer as a reset (StreamResetError) and discards in-flight
        // data, so the consumer must finish reading before the stream is closed, not race it.
        const received = (async () => {
          let bytesReceived = 0;
          for await (const chunk of connB) {
            bytesReceived += chunk.byteLength;
            if (bytesReceived >= expectedBytes) {
              break;
            }
          }
          return bytesReceived;
        })();

        // Sender: the work being measured.
        for (let i = 0; i < numberOfMessages; i++) {
          if (!connA.send(data)) {
            await connA.onDrain();
          }
        }

        // Assert full delivery before tearing down. This preserves a real correctness signal
        // (a send-path regression that drops data fails here) without suppressing any error, and
        // only then closes — so the close-as-reset can no longer race the reader.
        const bytesReceived = await received;
        if (bytesReceived !== expectedBytes) {
          throw new Error(`noise sendData: expected ${expectedBytes} bytes, received ${bytesReceived}`);
        }

        await connA.close();
      },
    });
  }
});
