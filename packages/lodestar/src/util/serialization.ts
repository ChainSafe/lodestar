import {IMerkleTreeSerialization} from "@chainsafe/eth2.0-utils";
import {MerkleTree} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export class MerkleTreeSerialization implements IMerkleTreeSerialization {

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig) {
    this.config = config;
  }

  public deserializeTree(tree: Buffer): MerkleTree {
    return this.config.types.MerkleTree.deserialize(tree);
  }

  public serializeLength(length: number): Buffer {
    return this.config.types.Uint256.serialize(BigInt(length));
  }

  public serializeTree(tree: MerkleTree): Buffer {
    return this.config.types.MerkleTree.serialize(tree);
  }

}
