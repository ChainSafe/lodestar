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
    return deserialize(tree, this.config.types.MerkleTree);
  }

  public serializeLength(length: number): Buffer {
    return serialize(BigInt(length), this.config.types.uint256);
  }

  public serializeTree(tree: MerkleTree): Buffer {
    return serialize(tree, this.config.types.MerkleTree);
  }

}
