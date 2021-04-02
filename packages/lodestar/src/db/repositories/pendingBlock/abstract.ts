import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {allForks} from "@chainsafe/lodestar-types";

/**
 * Blocks by root
 *
 * Used to store unfinalized blocks
 */
export class GenericBlockRepository extends Repository<Uint8Array, allForks.SignedBeaconBlock> {
  protected type: ContainerType<allForks.SignedBeaconBlock>;

  constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
    bucket: Bucket,
    type: ContainerType<allForks.SignedBeaconBlock>
  ) {
    super(config, db, bucket, type);
    this.type = type;
  }

  /**
   * Id is hashTreeRoot of unsigned BeaconBlock
   */
  getId(value: allForks.SignedBeaconBlock): Uint8Array {
    return this.type.fields["message"].hashTreeRoot(value.message);
  }
}
