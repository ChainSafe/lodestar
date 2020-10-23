import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState} from "@chainsafe/lodestar-types";
import {BeaconNode} from "@chainsafe/lodestar";
import {TreeBacked} from "@chainsafe/ssz";
import {getGenesisFileUrl} from "../../testnets";
import {downloadOrLoadFile} from "../../util";
import {IGlobalArgs} from "../../options";
import {IBeaconArgs} from "./options";

export async function initializeBeaconNodeState(node: BeaconNode, args: IBeaconArgs & IGlobalArgs): Promise<void> {
  if (args.testnet && !args.genesisStateFile) {
    args.genesisStateFile = getGenesisFileUrl(args.testnet) ?? undefined;
  }

  if (args.weakSubjectivityStateFile) {
    const weakSubjectivityState = await downloadOfLoadState(node.config, args.weakSubjectivityStateFile);
    await node.chain.initializeWeakSubjectivityState(weakSubjectivityState);
  } else if (args.genesisStateFile && !args.forceGenesis) {
    const genesisState = await downloadOfLoadState(node.config, args.genesisStateFile);
    await node.chain.initializeBeaconChain(genesisState);
  }
}

async function downloadOfLoadState(config: IBeaconConfig, pathOrUrl: string): Promise<TreeBacked<BeaconState>> {
  const stateBuffer = await downloadOrLoadFile(pathOrUrl);
  return config.types.BeaconState.tree.deserialize(stateBuffer);
}
