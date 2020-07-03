import {BeaconNode} from "../../../src/node";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {LogLevel, WinstonLogger} from "@chainsafe/lodestar-utils";
import {InteropEth1Notifier} from "../../../src/eth1/impl/interop";
import {createNodeJsLibp2p} from "../../../src/network/nodejs";
import {createPeerId} from "../../../src/network";
import {createEnr} from "@chainsafe/lodestar-cli/src/lodecli/network";
import tmp from "tmp";
import {initDevChain} from "../../../src/node/utils/state";
import {IBeaconParams} from "@chainsafe/lodestar-params";

export async function getDevBeaconNode(
  params: Partial<IBeaconParams>,
  validatorsCount = 8,
  genesisTime?: number
): Promise<BeaconNode> {
  const peerId = await createPeerId();
  const tmpDir = tmp.dirSync({unsafeCleanup: true});
  config.params = {
    ...config.params,
    ...params
  };
  const bn = new BeaconNode(
    {
      db: {
        name: tmpDir.name
      },
      sync: {
        minPeers: 1
      }
    },
    {
      config,
      logger: new WinstonLogger({level: LogLevel.error}),
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
  await initDevChain(bn, validatorsCount, genesisTime);
  return bn;
}
