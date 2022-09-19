import {Multiaddr} from "multiaddr";
import {createKeypairFromPeerId, Discv5, ENR, IDiscv5Metrics} from "@chainsafe/discv5";
import {RegistryMetricCreator} from "@lodestar/beacon-node";
import {collectNodeJSMetrics, defaultMetricsOptions, IMetrics} from "@lodestar/beacon-node/metrics";
import {HttpMetricsServer} from "@lodestar/beacon-node";
import {isLocalMultiAddr} from "@lodestar/beacon-node/network";
import {ILogger} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {createPeerId} from "../../config/peerId.js";
import {IGlobalArgs} from "../../options/index.js";
import {getCliLogger} from "../../util/index.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {IDiscv5Args} from "./options.js";
import {getNetworkBootnodes} from "../../networks/index.js";

const bindAddr = "/ip4/0.0.0.0/udp/9000";

export async function discv5Handler(args: IDiscv5Args & IGlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const metricRegister = new RegistryMetricCreator();

  const beaconPaths = getBeaconPaths(args, network);
  const logger = getCliLogger(args, beaconPaths, config);
  await startMetricServer(logger, metricRegister);

  const peerId = await createPeerId();
  const enr = ENR.createV4(createKeypairFromPeerId(peerId).publicKey);
  enr.tcp = 9000;
  enr.udp = 9000;

  if (enr.getLocationMultiaddr("udp") && !isLocalMultiAddr(enr.getLocationMultiaddr("udp"))) {
    clearMultiaddrUDP(enr);
  }

  const metrics = discv5Metrics(metricRegister);
  const bootnodes = await getNetworkBootnodes("goerli");
  const discv5 = Discv5.create({
    enr,
    peerId,
    multiaddr: new Multiaddr(bindAddr),
    config: {enrUpdate: false},
    // TODO: IDiscv5Metrics is not properly defined, should remove the collect() function
    metrics: (metrics as unknown) as {
      [K in keyof IMetrics["discv5"]]: IDiscv5Metrics[keyof IDiscv5Metrics];
    },
  });
  bootnodes.forEach((node) => discv5.addEnr(node));

  await discv5.start();
  logger.info("Started discv5");
}

async function startMetricServer(logger: ILogger, metricRegister: RegistryMetricCreator): Promise<void> {
  collectNodeJSMetrics(metricRegister);
  // start metrics http server
  const metricsServer = new HttpMetricsServer(defaultMetricsOptions, {
    register: metricRegister,
    logger: logger.child({module: "metrics"}),
  });
  await metricsServer.start();
  logger.info("Started metrics http server");
}

function clearMultiaddrUDP(enr: ENR): void {
  // enr.multiaddrUDP = undefined in new version
  enr.delete("ip");
  enr.delete("udp");
  enr.delete("ip6");
  enr.delete("udp6");
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function discv5Metrics(register: RegistryMetricCreator) {
  const discv5 = {
    kadTableSize: register.gauge({
      name: "lodestar_discv5_kad_table_size",
      help: "Total size of the discv5 kad table",
    }),
    lookupCount: register.gauge({
      name: "lodestar_discv5_lookup_count",
      help: "Total count of discv5 lookups",
    }),
    activeSessionCount: register.gauge({
      name: "lodestar_discv5_active_session_count",
      help: "Count of the discv5 active sessions",
    }),
    connectedPeerCount: register.gauge({
      name: "lodestar_discv5_connected_peer_count",
      help: "Count of the discv5 connected peers",
    }),
    sentMessageCount: register.gauge<"type">({
      name: "lodestar_discv5_sent_message_count",
      help: "Count of the discv5 messages sent by message type",
      labelNames: ["type"],
    }),
    rcvdMessageCount: register.gauge<"type">({
      name: "lodestar_discv5_rcvd_message_count",
      help: "Count of the discv5 messages received by message type",
      labelNames: ["type"],
    }),
  }

  return discv5;
}
