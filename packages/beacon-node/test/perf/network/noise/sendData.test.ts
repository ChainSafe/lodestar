import {itBench} from "@dapplion/benchmark";
import {duplexPair} from "it-pair/duplex";
import {pipe} from "it-pipe";
import drain from "it-drain";
import {defaultLogger} from "@libp2p/logger";
import {noise} from "@chainsafe/libp2p-noise";
import {Uint8ArrayList} from "uint8arraylist";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";

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
    itBench({
      id: `send data - ${numberOfMessages} ${messageLength}B messages`,
      beforeEach: async () => {
        const privateKeyA = await generateKeyPair("secp256k1");
        const privateKeyB = await generateKeyPair("secp256k1");
        const peerA = peerIdFromPrivateKey(privateKeyA);
        const peerB = peerIdFromPrivateKey(privateKeyB);
        const noiseA = noise()({logger: defaultLogger(), privateKey: privateKeyA, peerId: peerA});
        const noiseB = noise()({logger: defaultLogger(), privateKey: privateKeyB, peerId: peerB});

        const [inboundConnection, outboundConnection] = duplexPair<Uint8Array | Uint8ArrayList>();
        const [outbound, inbound] = await Promise.all([
          noiseA.secureOutbound(outboundConnection, {remotePeer: peerB}),
          noiseB.secureInbound(inboundConnection, {remotePeer: peerA}),
        ]);

        return {connA: outbound.conn, connB: inbound.conn, data: new Uint8Array(messageLength)};
      },
      fn: async ({connA, connB, data}) => {
        await Promise.all([
          //
          pipe(connB.source, connB.sink),
          pipe(function* () {
            for (let i = 0; i < numberOfMessages; i++) {
              yield data;
            }
          }, connA.sink),
          pipe(connB.source, drain),
        ]);
      },
    });
  }
});
