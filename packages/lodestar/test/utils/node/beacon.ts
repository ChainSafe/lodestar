import deepmerge from "deepmerge";
import tmp from "tmp";
import {createEnr} from "@chainsafe/lodestar-cli/src/network";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {IBeaconParams} from "@chainsafe/lodestar-params";
import {LogLevel, WinstonLogger, ILogger} from "@chainsafe/lodestar-utils";
import {BeaconNode} from "../../../src/node";
import {InteropEth1Notifier} from "../../../src/eth1/impl/interop";
import {createNodeJsLibp2p} from "../../../src/network/nodejs";
import {createPeerId} from "../../../src/network";
import {initDevChain} from "../../../src/node/utils/state";
import {IBeaconNodeOptions} from "../../../lib/node/options";

type RecursivePartial<T> = {
  [P in keyof T]?:
  T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
      T[P];
};

export async function getDevBeaconNode({
  params,
  options = {},
  validatorCount = 8,
  genesisTime,
  logger
}: {
  params: Partial<IBeaconParams>;
  options?: RecursivePartial<IBeaconNodeOptions>;
  validatorCount?: number;
  genesisTime?: number;
  logger?: ILogger;
}): Promise<BeaconNode> {
  const peerId = await createPeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  config.params = {
    ...config.params,
    ...params
  };
  const node = new BeaconNode(
    deepmerge({
      db: {
        name: tmpDir.name
      },
      sync: {
        minPeers: 1
      },
    }, options),
    {
      config,
      logger: logger || new WinstonLogger({level: LogLevel.error}),
      eth1: new InteropEth1Notifier(),
      libp2p: await createNodeJsLibp2p(
        peerId,
        {
          discv5: {
            enr: await createEnr(peerId),
            bindAddr: "/ip4/127.0.0.1/udp/0",
            bootEnrs: []
          },
          multiaddrs: [
            "/ip4/127.0.0.1/tcp/0"
          ]
        },
        false
      )
    });
  await initDevChain(node, validatorCount, genesisTime);
  return node;
}
