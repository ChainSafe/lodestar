import crypto from "node:crypto";
import PeerId from "peer-id";
import {Connection} from "libp2p";
import {Multiaddr} from "multiaddr";
import {createWinstonLogger, fromHex, LogLevel, toHex} from "@lodestar/utils";
import {chainConfig} from "@lodestar/config/default";
import {Discv5, ENR} from "@chainsafe/discv5";
import {createIBeaconConfig} from "@lodestar/config";
import {genesisData} from "@lodestar/config/networks";
import {GOODBYE_KNOWN_CODES, Libp2pEvent} from "./constants/network.js";
import {ENRKey, MetadataController} from "./network/metadata.js";
import {NetworkEvent, NetworkEventBus, NodejsNode, PeerRpcScoreStore, ReqResp} from "./network/index.js";
import {defaultRateLimiterOpts} from "./network/reqresp/response/rateLimiter.js";
import {Eth2PeerDataStore} from "./network/peers/datastore.js";
import {PeersData} from "./network/peers/peersData.js";
import {Method} from "./network/reqresp/types.js";

/* eslint-disable func-names, @typescript-eslint/no-empty-function */

const localPeerId = await PeerId.create({bits: 256, keyType: "secp256k1"});
const localEnr = ENR.createFromPeerId(localPeerId);

const p2pPort = 9596;
const p2pListenAddress = "0.0.0.0";
const maxPeers = 1000;
const targetPeers = 1000;
const peerStoreDir = ".tmp_peerstore";

const mainnetENRs = [
  // # Teku team's bootnodes",
  "enr:-KG4QOtcP9X1FbIMOe17QNMKqDxCpm14jcX5tiOE4_TyMrFqbmhPZHK_ZPG2Gxb1GE2xdtodOfx9-cgvNtxnRyHEmC0ghGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQDE8KdiXNlY3AyNTZrMaEDhpehBDbZjM_L9ek699Y7vhUJ-eAdMyQW_Fil522Y0fODdGNwgiMog3VkcIIjKA",
  "enr:-KG4QDyytgmE4f7AnvW-ZaUOIi9i79qX4JwjRAiXBZCU65wOfBu-3Nb5I7b_Rmg3KCOcZM_C3y5pg7EBU5XGrcLTduQEhGV0aDKQ9aX9QgAAAAD__________4JpZIJ2NIJpcIQ2_DUbiXNlY3AyNTZrMaEDKnz_-ps3UUOfHWVYaskI5kWYO_vtYMGYCQRAR3gHDouDdGNwgiMog3VkcIIjKA",

  // # Prylab team's bootnodes"
  "enr:-Ku4QImhMc1z8yCiNJ1TyUxdcfNucje3BGwEHzodEZUan8PherEo4sF7pPHPSIB1NNuSg5fZy7qFsjmUKs2ea1Whi0EBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQOVphkDqal4QzPMksc5wnpuC3gvSC8AfbFOnZY_On34wIN1ZHCCIyg",
  "enr:-Ku4QP2xDnEtUXIjzJ_DhlCRN9SN99RYQPJL92TMlSv7U5C1YnYLjwOQHgZIUXw6c-BvRg2Yc2QsZxxoS_pPRVe0yK8Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMeFF5GrS7UZpAH2Ly84aLK-TyvH-dRo0JM1i8yygH50YN1ZHCCJxA",
  "enr:-Ku4QPp9z1W4tAO8Ber_NQierYaOStqhDqQdOPY3bB3jDgkjcbk6YrEnVYIiCBbTxuar3CzS528d2iE7TdJsrL-dEKoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpD1pf1CAAAAAP__________gmlkgnY0gmlwhBLf22SJc2VjcDI1NmsxoQMw5fqqkw2hHC4F5HZZDPsNmPdB1Gi8JPQK7pRc9XHh-oN1ZHCCKvg",

  // # Lighthouse team's bootnodes"
  "enr:-Jq4QN6_FzIYyfJET9hiLcGUsg_EVOwCQ4bwsBwe0S4ElrfXUXufSYLtQAHU9_LuO9uice7EAaLbDlMK8QEhtyg8Oh4BhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQDGh4giXNlY3AyNTZrMaECSHaY_36GdNjF8-CLfMSg-8lB0wce5VRZ96HkT9tSkVeDdWRwgiMo",
  "enr:-Jq4QMOjjkLYSN7GVAf_zBSS5c_MokSPMZZvmjLUYiuHrPLHInjeBtF1IfskuYlmhglGan2ECmPk89SRXr4FY1jVp5YBhGV0aDKQtTA_KgAAAAD__________4JpZIJ2NIJpcIQi8wB6iXNlY3AyNTZrMaEC0EiXxAB2QKZJuXnUwmf-KqbP9ZP7m9gsRxcYvoK9iTCDdWRwgiMo",

  // # EF bootnodes"
  "enr:-Ku4QHqVeJ8PPICcWk1vSn_XcSkjOkNiTg6Fmii5j6vUQgvzMc9L1goFnLKgXqBJspJjIsB91LTOleFmyWWrFVATGngBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAMRHkWJc2VjcDI1NmsxoQKLVXFOhp2uX6jeT0DvvDpPcU8FWMjQdR4wMuORMhpX24N1ZHCCIyg",
  "enr:-Ku4QG-2_Md3sZIAUebGYT6g0SMskIml77l6yR-M_JXc-UdNHCmHQeOiMLbylPejyJsdAPsTHJyjJB2sYGDLe0dn8uYBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhBLY-NyJc2VjcDI1NmsxoQORcM6e19T1T9gi7jxEZjk_sjVLGFscUNqAY9obgZaxbIN1ZHCCIyg",
  "enr:-Ku4QPn5eVhcoF1opaFEvg1b6JNFD2rqVkHQ8HApOKK61OIcIXD127bKWgAtbwI7pnxx6cDyk_nI88TrZKQaGMZj0q0Bh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDayLMaJc2VjcDI1NmsxoQK2sBOLGcUb4AwuYzFuAVCaNHA-dy24UuEKkeFNgCVCsIN1ZHCCIyg",
  "enr:-Ku4QEWzdnVtXc2Q0ZVigfCGggOVB2Vc1ZCPEc6j21NIFLODSJbvNaef1g4PxhPwl_3kax86YPheFUSLXPRs98vvYsoBh2F0dG5ldHOIAAAAAAAAAACEZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDZBrP2Jc2VjcDI1NmsxoQM6jr8Rb1ktLEsVcKAPa08wCsKUmvoQ8khiOl_SLozf9IN1ZHCCIyg",

  // # Nimbus team's bootnodes"
  "enr:-LK4QLU5_AeUzZEtpK8grqPo4EmX4el3ochu8vNNoXX1PrBjYfn8ksjeQ1eFtbL7ywMau9k_7BBQGmO26DHWgngkBCgBh2F0dG5ldHOI__________-EZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhAN7_O-Jc2VjcDI1NmsxoQKH1zg2Fge8Q6Zf-rLFbjGEtgvVbmDXqFVLxqquJcguFIN0Y3CCI4yDdWRwgiOM",
  "enr:-LK4QLjSKc09WkFZ5Pa1UF3KPkt3ieTZ6B7F6iDL_chyniP5NVDl10aGIu-pL9mbwZ47GM3RN63eGHPsw-MTLSYcz74Bh2F0dG5ldHOI__________-EZXRoMpC1MD8qAAAAAP__________gmlkgnY0gmlwhDQ7fI6Jc2VjcDI1NmsxoQJDU6zzDlUDgUqFSzoIuP9bWu097k2d7X4eHoJTGhbphoN0Y3CCI4yDdWRwgiOM",
];

const logger = createWinstonLogger({level: LogLevel.debug});
const metrics = null;
const config = createIBeaconConfig(chainConfig, fromHex(genesisData.mainnet.genesisValidatorsRoot));

const discv5 = Discv5.create({
  enr: localEnr,
  peerId: localPeerId,
  multiaddr: new Multiaddr(`/ip4/${p2pListenAddress}/udp/${p2pPort}`),
  config: {lookupTimeout: 5000},
});

for (const mainnetENR of mainnetENRs) {
  discv5.addEnr(mainnetENR);
}

await discv5.start();
logger.info("Started discv5", {p2pListenAddress, p2pPort});

const datastore = new Eth2PeerDataStore(peerStoreDir);
await datastore.open();

const libp2p = new NodejsNode({
  peerId: localPeerId,
  addresses: {listen: [`/ip4/${p2pListenAddress}/tcp/${p2pPort}`]},
  datastore,
  maxConnections: maxPeers,
  minConnections: targetPeers,
});

const networkEventBus = new NetworkEventBus();
const reqResp = new ReqResp(
  {
    config,
    libp2p,
    peersData: new PeersData(),
    logger,
    metadata: new MetadataController({}, {logger, config}),
    reqRespHandlers: {
      onStatus: async function* (status) {
        // Echo remote status, okay with the spec
        logger.info(`Got status from peer, headSlot ${status.headSlot}`);
        yield status;
      },
      onBeaconBlocksByRange: async function* () {},
      onBeaconBlocksByRoot: async function* () {},
    },
    peerRpcScores: new PeerRpcScoreStore(),
    networkEventBus,
    metrics,
  },
  defaultRateLimiterOpts
);

await libp2p.start();
await reqResp.start();
logger.info("Started libp2p,reqResp", {p2pListenAddress, p2pPort});
let peerCount = 0;

libp2p.connectionManager.on(Libp2pEvent.peerConnect, (libp2pConnection: Connection) => {
  peerCount++;
  logger.info(`Peer connected     peers=${peerCount} ${libp2pConnection.remoteAddr.toString()}`);
});

libp2p.connectionManager.on(Libp2pEvent.peerDisconnect, (libp2pConnection: Connection) => {
  peerCount--;
  logger.info(`Peer disconnected  peers=${peerCount} ${libp2pConnection.remoteAddr.toString()}`);
});

runFindNodeForever(discv5).catch((e) => {
  logger.error("Error on discv5.findNode", {}, e);
});

networkEventBus.on(NetworkEvent.reqRespRequest, (requestTyped, peerId) => {
  if (requestTyped.method === Method.Goodbye) {
    const reason = GOODBYE_KNOWN_CODES[requestTyped.body.toString()] || "";
    logger.debug("Received goodbye", {reason, peer: peerId.toB58String()});
  }
});

discv5.on("discovered", async (enr) => {
  const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
  const eth2 = enr.get(ENRKey.eth2);

  // Ignore non-eth2 peers
  if (multiaddrTCP && eth2) {
    try {
      const peerId = await enr.peerId();

      logger.info(`Discovered ENR     ${multiaddrTCP?.toString()} ${toHex(eth2)} ${peerId.toB58String()}`);

      // Must add the multiaddrs array to the address book before dialing
      // https://github.com/libp2p/js-libp2p/blob/aec8e3d3bb1b245051b60c2a890550d262d5b062/src/index.js#L638
      await libp2p.peerStore.addressBook.add(peerId, [multiaddrTCP]);
      await libp2p.dial(peerId);

      logger.info(`Dialed peer        ${multiaddrTCP.toString()}`);
    } catch (e) {
      logger.error(`Error dialing discovered peer ${multiaddrTCP.toString()}`, {}, e as Error);
    }
  }
});

async function runFindNodeForever(discv5: Discv5): Promise<void> {
  while (true) {
    await discv5.findNode(crypto.randomBytes(64).toString("hex")).catch((e) => logger.error("findNode error", {}, e));
  }
}
