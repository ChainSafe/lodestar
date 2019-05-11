/**
 * @module validator
 */

import {BeaconBlock, Slot, ValidatorIndex} from "../types";
import {getRandaoMix, slotToEpoch} from "../chain/stateTransition/util";
import {RpcClient} from "./rpc";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";

export default class BlockProcessingService {
  private validatorIndex: ValidatorIndex;
  private provider: RpcClient;
  private privateKey: PrivateKey;

  public constructor(index: ValidatorIndex, provider: RpcClient, privateKey: PrivateKey) {
    this.validatorIndex = index;
    this.provider = provider;
    this.privateKey = privateKey;
  }

  /**
   * IFF a validator is selected construct a block to propose.
   */
  public async buildBlock(slot: Slot): Promise<BeaconBlock> {
    const block = await this.provider.validator.produceBlock(
      slot,
      getRandaoMix(
        await this.provider.beacon.getBeaconState(),
        slotToEpoch(slot)
      )
    );
    //TODO sign block
    await this.provider.validator.publishBlock(block);
    return block;
  }

  // private async assembleHeader(block: BeaconBlock): Promise<BeaconBlock> {
  //   const slot: number = await this.provider.getCurrentSlot();
  //   const prevBlock: BeaconBlock = await this.provider.getCurrentBlock();
  //   const curState: BeaconState = await this.provider.getCurrentState();
  //   // Note: To calculate state_root, the validator should first run the state transition function on an unsigned block
  //   // containing a stub for the state_root. It is useful to be able to run a state transition function that does not
  //   // validate signatures or state root for this purpose.
  //   block.slot = slot;
  //   block.previousBlockRoot = ssz.hashTreeRoot(prevBlock, BeaconBlock);
  //   block.stateRoot = ssz.hashTreeRoot(curState, BeaconState);
  //   // TODO Eth1Data
  //   block.signature = blsSign(
  //     this.privateKey,
  //     ssz.signingRoot(block, BeaconBlock),
  //     getDomain(curState, Domain.BEACON_PROPOSER)
  //   );
  //
  //   return block;
  // }
  //
  // private async assembleBody(block: BeaconBlock): Promise<BeaconBlock> {
  //   return block;
  // }
}
