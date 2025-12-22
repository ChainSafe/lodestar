import {generateKeyPair} from "@libp2p/crypto/keys";
import {PrivateKey} from "@libp2p/interface";
import deepmerge from "deepmerge";
import tmp from "tmp";
import {setHasher} from "@chainsafe/persistent-merkle-tree";
import {hasher} from "@chainsafe/persistent-merkle-tree/hasher/hashtree";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {ChainConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as minimalConfig} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {LoggerNode} from "@lodestar/logger/node";
import {ForkSeq, GENESIS_SLOT, SLOTS_PER_EPOCH, ZERO_HASH_HEX} from "@lodestar/params";
import {
  BeaconStateAllForks,
  Index2PubkeyCache,
  computeTimeAtSlot,
  createCachedBeaconState,
  syncPubkeys,
} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {RecursivePartial, isPlainObject, toRootHex} from "@lodestar/utils";
import {BeaconDb} from "../../../src/db/index.js";
import {BeaconNode} from "../../../src/index.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {IBeaconNodeOptions, defaultOptions} from "../../../src/node/options.js";
import {InteropStateOpts} from "../../../src/node/utils/interop/state.js";
import {initDevState} from "../../../src/node/utils/state.js";
import {testLogger} from "../logger.js";

export async function getDevBeaconNode(
  opts: {
    params: Partial<ChainConfig>;
    options?: RecursivePartial<IBeaconNodeOptions>;
    validatorCount?: number;
    logger?: LoggerNode;
    privateKey?: PrivateKey;
    peerStoreDir?: string;
    anchorState?: BeaconStateAllForks;
    wsCheckpoint?: phase0.Checkpoint;
  } & InteropStateOpts
): Promise<BeaconNode> {
  setHasher(hasher);
  const {params, validatorCount = 8, peerStoreDir} = opts;
  let {options = {}, logger, privateKey} = opts;

  if (!privateKey) privateKey = await generateKeyPair("secp256k1");
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  const config = createChainForkConfig({...minimalConfig, ...params});
  logger = logger ?? testLogger();

  const db = new BeaconDb(config, await LevelDbController.create({name: tmpDir.name}, {logger}));

  let anchorState = opts.anchorState;
  if (!anchorState) {
    anchorState = initDevState(config, validatorCount, opts);

    const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
    block.message.stateRoot = anchorState.hashTreeRoot();
    await db.blockArchive.add(block);

    if (config.getForkSeq(GENESIS_SLOT) >= ForkSeq.deneb) {
      const blobSidecars = ssz.deneb.BlobSidecars.defaultValue();
      const blockRoot = config.getForkTypes(GENESIS_SLOT).BeaconBlock.hashTreeRoot(block.message);
      await db.blobSidecars.add({blobSidecars, slot: GENESIS_SLOT, blockRoot});
    }
  }

  options = deepmerge(
    // This deepmerge should NOT merge the array with the defaults but overwrite them
    defaultOptions,
    deepmerge(
      // This deepmerge should merge all the array elements of the api options with the
      // dev defaults that we wish, especially for the api options
      {
        db: {name: tmpDir.name},
        api: {rest: {api: ["beacon", "config", "events", "node", "validator"], port: 19596}},
        metrics: {enabled: false},
        network: {
          discv5: null,
          localMultiaddrs: options.network?.localMultiaddrs || ["/ip4/127.0.0.1/tcp/0"],
          // Increase of following value is just to circumvent the following error in e2e tests
          // > libp2p:mplex rate limit hit when receiving messages
          disconnectThreshold: 255,
          targetPeers: defaultNetworkOptions.targetPeers,
          maxPeers: defaultNetworkOptions.maxPeers,
        },
        chain: {
          // configure supernode does not work because we don't get through cli
          initialCustodyGroupCount: config.NUMBER_OF_CUSTODY_GROUPS,
        },
        executionEngine: {
          mode: "mock",
          genesisBlockHash: ZERO_HASH_HEX,
          eth1BlockHash: opts.eth1BlockHash ? toRootHex(opts.eth1BlockHash) : undefined,
          fuluForkTimestamp: computeTimeAtSlot(
            config,
            config.FULU_FORK_EPOCH * SLOTS_PER_EPOCH,
            anchorState.genesisTime
          ),
          electraForkTimestamp: computeTimeAtSlot(
            config,
            config.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH,
            anchorState.genesisTime
          ),
          denebForkTimestamp: computeTimeAtSlot(
            config,
            config.DENEB_FORK_EPOCH * SLOTS_PER_EPOCH,
            anchorState.genesisTime
          ),
          capellaForkTimestamp: computeTimeAtSlot(
            config,
            config.CAPELLA_FORK_EPOCH * SLOTS_PER_EPOCH,
            anchorState.genesisTime
          ),
        },
      } as Partial<IBeaconNodeOptions>,
      options
    ),
    {
      arrayMerge: overwriteTargetArrayIfItems,
      isMergeableObject: isPlainObject,
    }
  );

  const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);
  const pubkey2index = new PubkeyIndexMap();
  const index2pubkey: Index2PubkeyCache = [];
  syncPubkeys(anchorState.validators.getAllReadonlyValues(), pubkey2index, index2pubkey);
  const cachedState = createCachedBeaconState(
    anchorState,
    {
      config: beaconConfig,
      pubkey2index,
      index2pubkey,
    },
    {skipSyncPubkeys: true}
  );

  return BeaconNode.init({
    opts: options as IBeaconNodeOptions,
    config: beaconConfig,
    pubkey2index,
    index2pubkey,
    db,
    logger,
    processShutdownCallback: () => {},
    privateKey,
    dataDir: ".",
    peerStoreDir,
    anchorState: cachedState,
    wsCheckpoint: opts.wsCheckpoint,
    isAnchorStateFinalized: true,
  });
}

function overwriteTargetArrayIfItems(target: unknown[], source: unknown[]): unknown[] {
  if (source.length === 0) {
    return target;
  }
  return source;
}
