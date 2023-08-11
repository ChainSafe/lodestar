import path from "node:path";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {Discv5} from "@chainsafe/discv5";
import {ErrorAborted} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {ACTIVE_PRESET, FAR_FUTURE_EPOCH, PresetName} from "@lodestar/params";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {HttpMetricsServer, RegistryMetricCreator, getHttpMetricsServer} from "@lodestar/beacon-node";
import {computeForkDataRoot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";

import {GlobalArgs} from "../../options/index.js";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {getNetworkBootnodes, isKnownNetworkName, readBootnodes} from "../../networks/index.js";
import {onGracefulShutdown, mkdir, writeFile600Perm, cleanOldLogFiles, parseLoggerArgs} from "../../util/index.js";
import {getVersionData} from "../../util/version.js";
import {initPeerIdAndEnr} from "../beacon/initPeerIdAndEnr.js";
import {parseArgs as parseMetricsArgs} from "../../options/beaconNodeOptions/metrics.js";
import {parseArgs as parseNetworkArgs} from "../../options/beaconNodeOptions/network.js";
import {getBeaconPaths} from "../beacon/paths.js";
import {BeaconArgs} from "../beacon/options.js";
import {BootnodeArgs} from "./options.js";

/**
 * Runs a bootnode.
 */
export async function bootnodeHandler(args: BootnodeArgs & GlobalArgs): Promise<void> {
  const {discv5Args, metricsArgs, beaconPaths, network, version, commit, peerId, enr, logger} =
    await bootnodeHandlerInit(args);

  // initialize directories
  mkdir(beaconPaths.dataDir);
  mkdir(beaconPaths.beaconDir);

  const abortController = new AbortController();
  const bindAddrs = discv5Args.bindAddrs;

  logger.info("Bootnode", {network, version, commit});
  if (ACTIVE_PRESET === PresetName.minimal) logger.info("ACTIVE_PRESET == minimal preset");

  // additional metrics registries
  let metricsRegistry;
  if (metricsArgs.enabled) {
    metricsRegistry = new RegistryMetricCreator();
  }

  // bootnode setup
  try {
    const discv5 = Discv5.create({
      enr,
      peerId,
      bindAddrs: {
        ip4: (bindAddrs.ip4 ? multiaddr(bindAddrs.ip4) : undefined) as Multiaddr,
        ip6: bindAddrs.ip6 ? multiaddr(bindAddrs.ip6) : undefined,
      },
      config: undefined,
      metricsRegistry,
    });
    for (const bootEnr of discv5Args.bootEnrs) {
      discv5.addEnr(bootEnr);
    }

    let metricsServer: HttpMetricsServer | undefined;
    if (metricsArgs.enabled && metricsRegistry) {
      metricsServer = await getHttpMetricsServer(metricsArgs, {register: metricsRegistry, logger});
    }

    // Intercept SIGINT signal, to perform final ops before exiting
    onGracefulShutdown(async () => {
      if (args.persistNetworkIdentity) {
        try {
          const enrPath = path.join(beaconPaths.beaconDir, "enr");
          writeFile600Perm(enrPath, enr);
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
          await metricsServer?.close();
          await discv5.stop();
          logger.debug("Bootnode closed");
          // Explicitly exit until active handles issue is resolved
          // See https://github.com/ChainSafe/lodestar/issues/5642
          process.exit(0);
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
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function bootnodeHandlerInit(args: BootnodeArgs & GlobalArgs) {
  const {config, network} = getBeaconConfigFromArgs(args);

  const {version, commit} = getVersionData();
  const beaconPaths = getBeaconPaths(args, network);
  const {discv5: discv5Args} = parseNetworkArgs(args);
  const metricsArgs = parseMetricsArgs(args);
  if (!discv5Args) {
    throw new Error("unreachable");
  }
  // const metricsOptions = {metadata: {version, commit, network}};

  // Fetch extra bootnodes
  discv5Args.bootEnrs = (discv5Args.bootEnrs ?? []).concat(
    args.bootnodesFile ? readBootnodes(args.bootnodesFile) : [],
    isKnownNetworkName(network) ? await getNetworkBootnodes(network) : []
  );

  const logger = initLogger(args, beaconPaths.dataDir, config);
  const {peerId, enr} = await initPeerIdAndEnr(args as unknown as BeaconArgs, beaconPaths.beaconDir, logger);
  if (!enr.kvs.get("eth2")) enr.set("eth2", bootnodeENRForkId(config));

  return {config, discv5Args, metricsArgs, beaconPaths, network, version, commit, peerId, enr, logger};
}

function bootnodeENRForkId(config: ChainForkConfig): Uint8Array {
  // For simplicity and by convention
  // Use the genesis fork version, a zeroed genesisValidatorsRoot, and the far future epoch
  // This is allowable considering the bootnode is not meant to be directly connected to beacon nodes
  const version = config.GENESIS_FORK_VERSION;
  const genesisValidatorsRoot = new Uint8Array(32);

  return ssz.phase0.ENRForkID.serialize({
    forkDigest: computeForkDataRoot(version, genesisValidatorsRoot).slice(0, 4),
    nextForkVersion: version,
    nextForkEpoch: FAR_FUTURE_EPOCH,
  });
}

export function initLogger(args: BootnodeArgs, dataDir: string, config: ChainForkConfig): LoggerNode {
  const defaultLogFilepath = path.join(dataDir, "bootnode.log");
  const logger = getNodeLogger(parseLoggerArgs(args, {defaultLogFilepath}, config));
  try {
    cleanOldLogFiles(args, {defaultLogFilepath});
  } catch (e) {
    logger.debug("Not able to delete log files", {}, e as Error);
  }

  return logger;
}
