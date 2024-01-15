import {itBench} from "@dapplion/benchmark";
import {duplexPair} from "it-pair/duplex";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {pipe} from "it-pipe";
import drain from "it-drain";
import {defaultLogger} from "@libp2p/logger";
import {noise} from "@chainsafe/libp2p-noise";
import {Uint8ArrayList} from "uint8arraylist";

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
        const peerA = await createSecp256k1PeerId();
        const peerB = await createSecp256k1PeerId();
        const noiseA = noise()({logger: defaultLogger()});
        const noiseB = noise()({logger: defaultLogger()});

        const [inboundConnection, outboundConnection] = duplexPair<Uint8Array | Uint8ArrayList>();
        const [outbound, inbound] = await Promise.all([
          noiseA.secureOutbound(peerA, outboundConnection, peerB),
          noiseB.secureInbound(peerB, inboundConnection, peerA),
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
