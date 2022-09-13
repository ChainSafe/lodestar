import path from "path";
import {Multiaddr} from "multiaddr";
import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";
import {BitArray, fromHexString} from "@chainsafe/ssz";
import {createNodeJsLibp2p, RegistryMetricCreator} from "@lodestar/beacon-node";
import {BareGossipsub} from "@lodestar/beacon-node/network";
import {ILogger, sleep} from "@lodestar/utils";
import {phase0, ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {HttpMetricsServer} from "@lodestar/beacon-node";
import {collectNodeJSMetrics, defaultMetricsOptions} from "@lodestar/beacon-node/metrics";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IGossipSubArgs} from "./options.js";
import {readPeerId, writePeerId} from "../../config/peerId.js";

const topic = "beacon-attestation";
const metricsTopicStrToLabel = new Map([[topic, topic]]);
const receiverPeerIdJsons = [
  {
    id: "16Uiu2HAkyUS8oQQFoH5DJQfYTe7h4wdNUmsSEGvK2hGiekpcvfKT",
    privKey: "CAISIJBB+uAebLmdXSiJNHX6VUs/28luaZXFIpY3dSq33xW/",
    pubKey: "CAISIQI8I9X8NUjrNXNcWk1BmssUlwF2TmewtI0e0+/AsVuLng==",
  },
  {
    id: "16Uiu2HAkySJyqxuhzVo9ntDeJaL1keetmG466LJwRucy3KTdW8bK",
    privKey: "CAISIGZVzkXGAnAPZ5MvPJkq4889lbW1gPj3ZbXa7FwLstJ5",
    pubKey: "CAISIQI7mJWxtYUN2h3CpWI7ePvcBoJ8b/5zDhdzh9AxG2q+Sg==",
  },
  {
    id: "16Uiu2HAkvdutXTRgpK7M1vvdf2Uru1UbdM6h6YrcVxsPUJjR83Dw",
    privKey: "CAISINE8Sz5xb/chKBRFxZHVyv0RTtiGzX2scZwr9p8UU2Ew",
    pubKey: "CAISIQIR/mJAWO9JS5XixWoYGbvCy8rHQ1W4lGvmcKL6oUfVzg==",
  },
  {
    id: "16Uiu2HAmCHHMCWHM325y2D9LpKzCeFnWgB9i8sk44sJR9jBk2unP",
    privKey: "CAISIKS95JGuTbykkhAw1uTOFcNp5ai701bnxWGosxQCw9N3",
    pubKey: "CAISIQL6cHFAslosHLiqLz6niNa8YOum/dSxPUXiRwrpYIM2MA==",
  },
  {
    id: "16Uiu2HAkunT4s56tCsdLv9kvyWqSzzBxB8U2ABaMS9PUNXFRL2u7",
    privKey: "CAISIL/CIgKcatakp8jCmfKNJbNdtM5Yu5XlTrmiZ59jwuTS",
    pubKey: "CAISIQIFUpjA9HnOVIVfouIPvDFB+TKJB2h2MlTvii6vRLypKg==",
  },
  {
    id: "16Uiu2HAm5uwnPGvqYZxF4LFSraJqQvdfFVgJwQRxboqUJFAsRjpZ",
    privKey: "CAISIJqHhUseB/WVpsg3ONcpk3jNiU8ZwFiXTZ8QKxDsmYdR",
    pubKey: "CAISIQKb0wAyH5YqkhhcR1JqgSf72JDxzkoKQ0u5TELgTVeTLg==",
  },
  {
    id: "16Uiu2HAmEAHYPqtvvJuoTj8ZjHk5y8628yqVsQbw4zfK6fWfLT7r",
    privKey: "CAISIDnETF06D2diW58lA5uJdJaeLlG6r/YhcV+00skadrAJ",
    pubKey: "CAISIQMWXPgFufzsWLq+zT1bb1nVEIvAwP9748bAH27wQK13rQ==",
  },
  {
    id: "16Uiu2HAkxYX2QDkbyv8FqJs3ooVTn28WTVTMG4wSeFQ8Mt5xStRg",
    privKey: "CAISICMlo9TAW0iT08rMR6vWy+czi/8mVdXBupKuDU/DuH9r",
    pubKey: "CAISIQIuVAA9/F1aM/xiQzdf5A83hh1yA/K6lGZ4oG1Ut8+0Ww==",
  },
  {
    id: "16Uiu2HAmDryajf76rPunFbSatd99ERgNeQgMCHwDdW9JQGhbEQqU",
    privKey: "CAISIFh/PobmqDJy5f8OE1f0CmjXOA2U1YAndvnVmE9QylqM",
    pubKey: "CAISIQMR7cm+0G4cIydoacLerq8YBfDU6ofyB2nvw+8MgryOnw==",
  },
  {
    id: "16Uiu2HAm6QBAL8EWuMs82t6Zm5v7yeKr55WQnTdYttVheuZQD983",
    privKey: "CAISIOuhCPr0J9FWDQtY/NaVdmwOp4AnwJqKrLrU+QEKmaF9",
    pubKey: "CAISIQKjDmPw5r6X2B90trv8s9ULo9UqE29GdLzYkLuMeuViiA==",
  },
  {
    id: "16Uiu2HAmM2kc7RtZRc7wR3Boo43p1dK7yTbErD9vLrmVEU8rUtXw",
    privKey: "CAISIFjadPFUc+tFPvnv5ur4Z8HPGyQ+vUzYwEtASi4sq7iA",
    pubKey: "CAISIQN8cLt4nCVOGwLBllEQmoCYc+iydawrtTXrl6FhwMgQFg==",
  },
  {
    id: "16Uiu2HAmCvFDYNJnMsVhjTrJuN7Wc23wkocE9ezH9CN1GiSAuu3n",
    privKey: "CAISIBXEE16e3W2BDUyl37yqdbFn3TiQZV+Ad7vC1RCz2+vN",
    pubKey: "CAISIQMD6IWKIwWdgOjRAXN3FsQ/FKqvVIkvYG/p2J+NS+kaAQ==",
  },
  {
    id: "16Uiu2HAm4Sbn4Ls4QGab5QhVf42gmHGg9FMbaPxgo5jtYcnefSXZ",
    privKey: "CAISIOUTpTaslmS28H7x+UfkSJojVKa1pHLcGpNxFzhelxyH",
    pubKey: "CAISIQKF9gL1dUzKbHvLncK7m0YCx2RrvngcTrAgu9SiQ4BpEA==",
  },
  {
    id: "16Uiu2HAmPiWA3tfQ8xm2QmUznVAgQn2HVSZsCf1hMxow8TUeLpB6",
    privKey: "CAISIG7xdVoVnbBxazqotGLVlsxOwZy1zE8P8kij7h7OgUGB",
    pubKey: "CAISIQOkVwAofpnUTU6LOLUaIUkl8GdSFfcL86ZwSNHIpEfyDQ==",
  },
  {
    id: "16Uiu2HAm4wQbMrPBt53EwSFHCnsVb5Lb6GqVAwr2udRyL569fUBL",
    privKey: "CAISIPPUvbbH6x/j9iuwsBbwlx2INkNX2EJ/NPu9JHMHfAIf",
    pubKey: "CAISIQKNVzVu2izK2IZQ4YVOMXWtK0c6HWmjoQunxOwDmRHEMw==",
  },
];
const receiverMultiAddrStrTemplate = "/ip4/0.0.0.0/tcp/100";
const senderMultiAddr = "/ip4/0.0.0.0/tcp/9999";

function getReceiverMultiAddrStr(i: number): string {
  return receiverMultiAddrStrTemplate + (i < 10 ? "0" + i : i);
}

const committeeSize = 200;

const seedAttestation: phase0.Attestation = {
  aggregationBits: BitArray.fromBoolArray(Array.from({length: committeeSize}, () => false)),
  data: {
    slot: 3849723,
    index: 51,
    beaconBlockRoot: fromHexString("0x336304cc19cc0cfacb234c52ba4c12d73be9e581fba26d6da401f16dc685dc23"),
    source: {
      epoch: 120302,
      root: fromHexString("0xe312659945be76a65a8bc9288246eb555073056664733a9313b4615e08a0d18b"),
    },
    target: {
      epoch: 120303,
      root: fromHexString("0x467997e91dec5b8f4b2cc4e67d82a761cfddecbcb6a3b1abc5d46646203b2512"),
    },
  },
  signature: fromHexString(
    "0xa0a09d4d138a959fc3513289feefb2e65c4339fe7a505d8ba794b48eb1bc6f359e6a3e7643a4a5717ec5c64e32b6666d02d69b5cff4487d2fc76e67dedb79ebf0500e2c844d8ceff5c29d2d1c73c7e61fb369075a09abdaece4a2657846a500a"
  ),
};

/**
 * Assuming there are 500000 validators, per slot = 15625 messages
 * per subnet = per slot / 64 ~= 2441, make it 2500
 */
const messagesPerSecond = 2500;

const numSenders = 1;
const numReceivers = 15;

// goerli on Sep 02 2022 at around 08:00am UTC
const startSlot = 3849723;

export async function gossipsubHandler(args: IGossipSubArgs & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);

  const beaconPaths = getBeaconPaths(args, network);
  const logger = getCliLogger(args, beaconPaths, config);
  const {receiver} = args;
  const receiverPeerIds = await Promise.all(receiverPeerIdJsons.map((json) => PeerId.createFromJSON(json)));

  const numNode = receiver ? numReceivers : numSenders;

  const promises: Promise<void>[] = [];

  for (let nodeIndex = 0; nodeIndex < numNode; nodeIndex++) {
    const peerId = receiver ? receiverPeerIds[nodeIndex] : await PeerId.create({keyType: "secp256k1"});
    // const peerId = await PeerId.create({keyType: "secp256k1"});
    // console.log("peerId json", peerId.toJSON());

    const libp2p = await createNodeJsLibp2p(
      peerId,
      {
        localMultiaddrs: receiver ? [getReceiverMultiAddrStr(nodeIndex)] : [senderMultiAddr],
      },
      {
        peerStoreDir: path.join(beaconPaths.peerStoreDir, String(nodeIndex)),
      }
    );
    logger.info("Initialized libp2p", {receiver, nodeIndex});

    const metricRegister = receiver ? undefined : new RegistryMetricCreator();
    const gossip = new BareGossipsub({libp2p, logger, metricRegister}, {metricsTopicStrToLabel});

    logger.info("Initialized gossipsub", {receiver, nodeIndex});

    await libp2p.start();
    await gossip.start();

    logger.info("Started libp2p and gossipsub", {receiver, nodeIndex});
    gossip.subscribe(topic);
    logger.info("Subscribed to topic", {topic, nodeIndex});

    libp2p.connectionManager.on("peer:connect", (libp2pConnection: Connection) => {
      const peer = libp2pConnection.remotePeer;
      logger.info("Peer connected", {peerId: peer.toB58String(), nodeIndex});
    });

    if (!receiver && metricRegister) {
      collectNodeJSMetrics(metricRegister);
      // start metrics http server
      const metricsServer = new HttpMetricsServer(defaultMetricsOptions, {
        register: metricRegister,
        logger: logger.child({module: "metrics"}),
      });
      await metricsServer.start();
      logger.info("Started http metric server");
      promises.push(dialAndSend(libp2p, gossip, logger, receiverPeerIds, nodeIndex));
    }
  } // end for

  await Promise.all(promises);
}

async function dialAndSend(
  libp2p: LibP2p,
  gossip: BareGossipsub,
  logger: ILogger,
  receiverPeerIds: PeerId[],
  nodeIndex: number
): Promise<void> {
  // same to connectToPeer
  for (const [i, receiverPeerId] of receiverPeerIds.entries()) {
    logger.info("Dialing receiver", {i});
    await libp2p.peerStore.addressBook.add(receiverPeerId, [new Multiaddr(getReceiverMultiAddrStr(i))]);
    await libp2p.dial(receiverPeerId);
  }
  await sendMessages(gossip, logger, nodeIndex, receiverPeerIds.length);
}

async function sendMessages(
  gossip: BareGossipsub,
  logger: ILogger,
  nodeIndex: number,
  expectedPeers: number
): Promise<void> {
  // @ts-ignore
  while (gossip.peers.size < expectedPeers) {
    // @ts-ignore
    logger.info("Not enough peers, retry in 5s", {nodeIndex, peers: gossip.peers.size, expectedPeers});
    await sleep(5 * 1000);
  }
  // @ts-ignore
  logger.info("Found enough peers", {nodeIndex, peers: gossip.peers.size});
  // @ts-ignore
  logger.info("Found peers", {numPeer: gossip.peers.size, nodeIndex});

  let slot = startSlot;
  // send to receiver per 100ms
  const timesPerSec = 10;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1 / 10 of 1 second
    await sleep(1000 / timesPerSec);
    const epoch = computeEpochAtSlot(slot);
    // each sender sends different set of messages, then it'll gossip to each other
    // including the receiver
    const messagesPerSender = Math.floor(messagesPerSecond / timesPerSec / numSenders);

    for (let i = nodeIndex * messagesPerSender; i < nodeIndex * messagesPerSender + messagesPerSender; i++) {
      const attestation: phase0.Attestation = {
        ...seedAttestation,
      };
      attestation.aggregationBits.set(i % committeeSize, true);
      attestation.data.slot = slot;
      // as in goerli there are 64 committees per slot
      attestation.data.index = nodeIndex;
      attestation.data.source.epoch = epoch - 1;
      attestation.data.target.epoch = epoch;

      const bytes = ssz.phase0.Attestation.serialize(attestation);
      // make sure it's unique
      bytes[bytes.length - 1] = i;
      try {
        await gossip.publish(topic, bytes);
      } catch (e) {
        // messages are unique per gossip but
        // could have duplicate error here due to IWANT/IHAVE
        // this is fine as long as the metrics of receiver shows good result
      }
    }

    slot++;
  }
}
