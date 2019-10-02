import {MerkleTree} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../../../../constants";
import {IProgressiveMerkleTree, ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";
import {MerkleTreeSerialization} from "../../../../util/serialization";

export class MerkleTreeRepository extends BulkRepository<MerkleTree> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.merkleTree, config.types.MerkleTree);
  }

  public async getProgressiveMerkleTree(
    config: IBeaconConfig,
    index: number
  ): Promise<IProgressiveMerkleTree> {
    const tree = await this.get(index);
    const serialization = new MerkleTreeSerialization(config);
    if(!tree) return ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH, serialization);
    return new ProgressiveMerkleTree(tree.depth, tree.tree, serialization);
  }

}
