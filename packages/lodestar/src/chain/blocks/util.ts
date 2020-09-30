import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {IBlockProcessJob} from "../interface";

export function findUnknownAncestor(config: IBeaconConfig, jobs: IBlockProcessJob[] = [], root: Root): Root {
  const blocksByRoot = new Map<string, SignedBeaconBlock>();
  const blocks = jobs.map((job) => job.signedBlock);
  blocks.forEach((block) => blocksByRoot.set(toHexString(config.types.BeaconBlock.hashTreeRoot(block.message)), block));
  let parentRoot = root;
  while (blocksByRoot.has(toHexString(parentRoot))) {
    parentRoot = blocksByRoot.get(toHexString(parentRoot))?.message.parentRoot!;
  }
  return parentRoot;
}
