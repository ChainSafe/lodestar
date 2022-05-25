import deepmerge from "deepmerge";
import tmp from "tmp";
import PeerId from "peer-id";
import {createEnr} from "../../../../cli/src/config/enr.js";
import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig, createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ILogger, RecursivePartial} from "@chainsafe/lodestar-utils";
import {LevelDbController} from "@chainsafe/lodestar-db";
import {phase0} from "@chainsafe/lodestar-types";
import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {BeaconNode} from "../../../src/node/index.js";
import {createNodeJsLibp2p} from "../../../src/network/nodejs/index.js";
import {createPeerId} from "../../../src/network/index.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {initDevState} from "../../../src/node/utils/state.js";
import {IBeaconNodeOptions} from "../../../src/node/options.js";
import {defaultOptions} from "../../../src/node/options.js";
import {BeaconDb} from "../../../src/db/index.js";
import {testLogger} from "../logger.js";
import {InteropStateOpts} from "../../../src/node/utils/interop/state.js";
import {isPlainObject} from "@chainsafe/lodestar-utils";

export async function getDevBeaconNode(
  opts: {
    params: Partial<IChainConfig>;
    options?: RecursivePartial<IBeaconNodeOptions>;
    validatorCount?: number;
    logger?: ILogger;
    peerId?: PeerId;
    peerStoreDir?: string;
    anchorState?: BeaconStateAllForks;
    wsCheckpoint?: phase0.Checkpoint;
  } & InteropStateOpts
): Promise<BeaconNode> {
  const {params, validatorCount = 8, peerStoreDir} = opts;
  let {options = {}, logger, peerId} = opts;

  if (!peerId) peerId = await createPeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createIChainForkConfig({...minimalConfig, ...params});
  logger = logger ?? testLogger();

  const db = new BeaconDb({config, controller: new LevelDbController({name: tmpDir.name}, {logger})});
  await db.start();

  const libp2p = await createNodeJsLibp2p(
    peerId,
    {
      discv5: {
        enabled: false,
        enr: createEnr(peerId),
        bindAddr: options.network?.discv5?.bindAddr || "/ip4/127.0.0.1/udp/0",
        bootEnrs: [],
      },
      localMultiaddrs: options.network?.localMultiaddrs || ["/ip4/127.0.0.1/tcp/0"],
      targetPeers: defaultNetworkOptions.targetPeers,
      maxPeers: defaultNetworkOptions.maxPeers,
    },
    {disablePeerDiscovery: true, peerStoreDir}
  );

  options = deepmerge(
    // This deepmerge should NOT merge the array with the defaults but overwrite them
    defaultOptions,
    deepmerge(
      // This deepmerge should merge all the array elements of the api options with the
      // dev defaults that we wish, especially for the api options
      {
        db: {name: tmpDir.name},
        eth1: {enabled: false},
        api: {rest: {api: ["beacon", "config", "events", "node", "validator"], port: 19596}},
        metrics: {enabled: false},
        network: {discv5: null},
      } as Partial<IBeaconNodeOptions>,
      options
    ),
    {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    }
  );

  const state = opts.anchorState || (await initDevState(config, db, validatorCount, opts));
  const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
  return await BeaconNode.init({
    opts: options as IBeaconNodeOptions,
    config: beaconConfig,
    db,
    logger,
    libp2p,
    anchorState: state,
    wsCheckpoint: opts.wsCheckpoint,
  });
}

function overwriteTargetArrayIfItems(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
