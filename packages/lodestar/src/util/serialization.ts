import {IMerkleTreeSerialization} from "@chainsafe/eth2.0-utils";
import {MerkleTree} from "@chainsafe/eth2.0-types";
import {deserialize, serialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export class MerkleTreeSerialization implements IMerkleTreeSerialization {

  private readonly config: IBeaconConfig;

  public constructor(config: IBeaconConfig) {
    this.config = config;
  }

  public deserializeTree(tree: Buffer): MerkleTree {
    return deserialize(this.config.types.MerkleTree, tree);
  }

  public serializeLength(length: number): Buffer {
    return serialize(this.config.types.uint256, BigInt(length));
  }

  public serializeTree(tree: MerkleTree): Buffer {
    return serialize(this.config.types.MerkleTree, tree);
  }

}
