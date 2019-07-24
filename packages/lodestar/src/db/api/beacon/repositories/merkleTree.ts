import {MerkleTree} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {IProgressiveMerkleTree, ProgressiveMerkleTree} from "../../../../util/merkleTree";

export class MerkleTreeRepository extends BulkRepository<MerkleTree> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.merkleTree, config.types.MerkleTree);
  }

  public async getProgressiveMerkleTree(index: number): Promise<IProgressiveMerkleTree> {
    const tree = await this.get(index);
    return new ProgressiveMerkleTree(tree.depth, tree.tree);
  }

}
