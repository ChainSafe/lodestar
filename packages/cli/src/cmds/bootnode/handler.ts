import path from "node:path";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {Discv5} from "@chainsafe/discv5";
import {ENR} from "@chainsafe/enr";
import {ErrorAborted} from "@lodestar/utils";
import {HttpMetricsServer, RegistryMetricCreator, getHttpMetricsServer} from "@lodestar/beacon-node";

import {GlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {getNetworkBootnodes, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {onGracefulShutdown, mkdir, writeFile600Perm} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {initPeerIdAndEnr} from "../beacon/initPeerIdAndEnr.js";
import {parseArgs as parseMetricsArgs} from "../../options/beaconNodeOptions/metrics.js";
import {parseArgs as parseNetworkArgs} from "../../options/beaconNodeOptions/network.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {BeaconArgs} from "../beacon/options.js";
import {initLogger} from "../beacon/handler.js";
import {BootnodeArgs} from "./options.js";

/**
 * Runs a bootnode.
 */
export async function bootnodeHandler(args: BootnodeArgs & GlobalArgs): Promise<void> {
  const {discv5Args, metricsArgs, bootnodeDir, network, version, commit, peerId, enr, logger} =
    await bootnodeHandlerInit(args);

  const abortController = new AbortController();
  const bindAddrs = discv5Args.bindAddrs;

  logger.info("Lodestar Bootnode", {network, version, commit});
  logger.info("Bind address", bindAddrs);
  logger.info("Advertised address", {
    ip4: enr.getLocationMultiaddr("udp4")?.toString(),
    ip6: enr.getLocationMultiaddr("udp6")?.toString(),
  });
  logger.info("Identity", {peerId: peerId.toString(), nodeId: enr.nodeId});
  logger.info("ENR", {enr: enr.encodeTxt()});

  // bootnode setup
  try {
    let metricsRegistry: RegistryMetricCreator | undefined;
    let metricsServer: HttpMetricsServer | undefined;
    if (metricsArgs.enabled) {
      metricsRegistry = new RegistryMetricCreator();
      metricsRegistry.static({
        name: "bootnode_version",
        help: "Bootnode version",
        value: {version, commit, network},
      });
      metricsServer = await getHttpMetricsServer(metricsArgs, {register: metricsRegistry, logger});
    }

    const discv5 = Discv5.create({
      enr,
      peerId,
      bindAddrs: {
        ip4: (bindAddrs.ip4 ? multiaddr(bindAddrs.ip4) : undefined) as Multiaddr,
        ip6: bindAddrs.ip6 ? multiaddr(bindAddrs.ip6) : undefined,
      },
      config: {enrUpdate: !enr.ip && !enr.ip6},
      metricsRegistry,
    });

    // If there are any bootnodes, add them to the routing table
    for (const bootEnrStr of Array.from(new Set(discv5Args.bootEnrs).values())) {
      const bootEnr = ENR.decodeTxt(bootEnrStr);
      logger.info("Adding bootnode", {
        ip4: bootEnr.getLocationMultiaddr("udp4")?.toString(),
        ip6: bootEnr.getLocationMultiaddr("udp6")?.toString(),
        peerId: (await bootEnr.peerId()).toString(),
        nodeId: enr.nodeId,
      });
      discv5.addEnr(bootEnr);
    }

    // start the server
    await discv5.start();

    // if there are peers in the local routing table, establish a session by running a query
    if (discv5.kadValues().length) {
      void discv5.findRandomNode();
    }

    discv5.on("multiaddrUpdated", (addr) => {
      logger.info("Advertised socket address updated", {addr: addr.toString()});
    });

    // respond with metrics every 10 seconds
    const printInterval = setInterval(() => {
      let ip4Only = 0;
      let ip6Only = 0;
      let ip4ip6 = 0;
      let unreachable = 0;
      for (const kadEnr of discv5.kadValues()) {
        const hasIp4 = kadEnr.getLocationMultiaddr("udp4");
        const hasIp6 = kadEnr.getLocationMultiaddr("udp6");
        if (hasIp4 && hasIp6) {
          ip4ip6++;
        } else if (hasIp4) {
          ip4Only++;
        } else if (hasIp6) {
          ip6Only++;
        } else {
          unreachable++;
        }
      }
      logger.info("Server metrics", {
        connectedPeers: discv5.connectedPeerCount,
        activeSessions: discv5.sessionService.sessionsSize(),
        ip4Nodes: ip4Only,
        ip6Nodes: ip6Only,
        ip4AndIp6Nodes: ip4ip6,
        unreachableNodes: unreachable,
      });
    }, 10_000);

    // Intercept SIGINT signal, to perform final ops before exiting
    onGracefulShutdown(async () => {
      if (args.persistNetworkIdentity) {
        try {
          const enrPath = path.join(bootnodeDir, "enr");
          writeFile600Perm(enrPath, enr.encodeTxt());
        } catch (e) {
          logger.warn("Unable to persist enr", {}, e as Error);
        }
      }
      abortController.abort();
    }, logger.info.bind(logger));

    abortController.signal.addEventListener(
      "abort",
      async () => {
        try {
          discv5.removeAllListeners();
          clearInterval(printInterval);

          await metricsServer?.close();
          await discv5.stop();
          logger.debug("Bootnode closed");
        } catch (e) {
          logger.error("Error closing bootnode", {}, e as Error);
          // Must explicitly exit process due to potential active handles
          process.exit(1);
        }
      },
      {once: true}
    );
  } catch (e) {
    if (e instanceof ErrorAborted) {
      logger.info(e.message); // Let the user know the abort was received but don't print as error
    } else {
      throw e;
    }
  }
}

/** Separate function to simplify unit testing of options merging */
export async function bootnodeHandlerInit(args: BootnodeArgs & GlobalArgs) {
  const {config, network} = getBeaconConfigFromArgs(args);
  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args, network);
  // Use a separate directory to store bootnode enr + peer-id
  const bootnodeDir = path.join(beaconPaths.dataDir, "bootnode");
  const {discv5: discv5Args} = parseNetworkArgs(args);
  const metricsArgs = parseMetricsArgs(args);
  if (!discv5Args) {
    // Unreachable because bootnode requires discv5 to be enabled - duh
    throw new Error("unreachable - bootnode requires discv5 to be enabled");
  }

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(bootnodeDir);

  // Fetch extra bootnodes
  discv5Args.bootEnrs = (discv5Args.bootEnrs ?? []).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    isKnownNetworkName(network) ? await getNetworkBootnodes(network) : []
  );

  const logger = initLogger(args, beaconPaths.dataDir, config, "bootnode.log");
  const {peerId, enr} = await initPeerIdAndEnr(args as unknown as BeaconArgs, bootnodeDir, logger, true);

  return {discv5Args, metricsArgs, bootnodeDir, network, version, commit, peerId, enr, logger};
}
