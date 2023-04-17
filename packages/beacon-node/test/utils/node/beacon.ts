import deepmerge from "deepmerge";
import tmp from "tmp";
import {PeerId} from "@libp2p/interface-peer-id";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {config as minimalConfig} from "@lodestar/config/default";
import {createBeaconConfig, createChainForkConfig, ChainConfig} from "@lodestar/config";
import {Logger, RecursivePartial} from "@lodestar/utils";
import {LevelDbController} from "@lodestar/db";
import {phase0, ssz} from "@lodestar/types";
import {ForkSeq, GENESIS_SLOT} from "@lodestar/params";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {isPlainObject} from "@lodestar/utils";
import {BeaconNode} from "../../../src/index.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {initDevState, writeDeposits} from "../../../src/node/utils/state.js";
import {IBeaconNodeOptions} from "../../../src/node/options.js";
import {defaultOptions} from "../../../src/node/options.js";
import {BeaconDb} from "../../../src/db/index.js";
import {testLogger} from "../logger.js";
import {InteropStateOpts} from "../../../src/node/utils/interop/state.js";

export async function getDevBeaconNode(
  opts: {
    params: Partial<ChainConfig>;
    options?: RecursivePartial<IBeaconNodeOptions>;
    validatorCount?: number;
    logger?: Logger;
    peerId?: PeerId;
    peerStoreDir?: string;
    anchorState?: BeaconStateAllForks;
    wsCheckpoint?: phase0.Checkpoint;
  } & InteropStateOpts
): Promise<BeaconNode> {
  const {params, validatorCount = 8, peerStoreDir} = opts;
  let {options = {}, logger, peerId} = opts;

  if (!peerId) peerId = await createSecp256k1PeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createChainForkConfig({...minimalConfig, ...params});
  logger = logger ?? testLogger();

  const db = new BeaconDb({config, controller: new LevelDbController({name: tmpDir.name}, {logger})});
  await db.start();

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
        network: {
          discv5: null,
          localMultiaddrs: options.network?.localMultiaddrs || ["/ip4/127.0.0.1/tcp/0"],
          targetPeers: defaultNetworkOptions.targetPeers,
          maxPeers: defaultNetworkOptions.maxPeers,
        },
      } as Partial<IBeaconNodeOptions>,
      options
    ),
    {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    }
  );

  let anchorState = opts.anchorState;
  if (!anchorState) {
    const {state, deposits} = initDevState(config, validatorCount, opts);
    anchorState = state;

    // Is it necessary to persist deposits and genesis block?
    await writeDeposits(db, deposits);
    const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
    block.message.stateRoot = state.hashTreeRoot();
    await db.blockArchive.add(block);

    if (config.getForkSeq(GENESIS_SLOT) >= ForkSeq.deneb) {
      const blobsSidecar = ssz.deneb.BlobsSidecar.defaultValue();
      blobsSidecar.beaconBlockRoot = config.getForkTypes(GENESIS_SLOT).BeaconBlock.hashTreeRoot(block.message);
      await db.blobsSidecar.add(blobsSidecar);
    }
  }

  const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);
  return BeaconNode.init({
    opts: options as IBeaconNodeOptions,
    config: beaconConfig,
    db,
    logger,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    processShutdownCallback: () => {},
    peerId,
    peerStoreDir,
    anchorState,
    wsCheckpoint: opts.wsCheckpoint,
  });
}

function overwriteTargetArrayIfItems(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
