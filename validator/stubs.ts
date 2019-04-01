// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
// Subject to change with future developments with Hobbits and wire protocol
import BN from "bn.js";
import blgr from "blgr";
import {ValidatorIndex, Slot, BeaconBlock, BeaconState} from "../src/types";

// Super awesome stubs
function notSoRandomRandomBoolean(): boolean {
  return [true, false][Math.round(Math.random())];
}

function notSoRandomRandomValidatorIndex(): ValidatorIndex {
  return new BN(Math.round(Math.random() * 1000));
}

function notSoRandomRandomSlot(): Slot {
  return new BN(Math.round(Math.random() * 1000));
}

export default class RPCProvider {
  private readonly rpcUrl: string;
  private validatorIndex: ValidatorIndex;
  private currentSlot: Slot;
  private logger: blgr;

  public constructor(url: string, logger: blgr) {
    this.rpcUrl = url;
    this.logger = logger;

    // Automatically attempt to make a connection
    this.connect();
  }

  private connect(): boolean {
    return true;
  }

  public isActiveValidator(index: ValidatorIndex): boolean {
    return notSoRandomRandomBoolean();
  }

  public getValidatorIndex(pubkey: string): ValidatorIndex {
    this.validatorIndex = notSoRandomRandomValidatorIndex();
    return this.validatorIndex;
  }

  public getBeaconProposer(): ValidatorIndex {
    const rand = notSoRandomRandomValidatorIndex();
    return rand > this.validatorIndex ? rand : this.validatorIndex;
  }

  public getCurrentBlock(): BeaconBlock {
    let b: BeaconBlock;
    return  b;
  }

  public getCurrentState(): BeaconState {
    let b: BeaconState;
    return b;
  }

  public getCurrentSlot(): Slot {
    if (!this.currentSlot) {
      const slot = notSoRandomRandomSlot();
      this.currentSlot = slot;
      return slot;
    } else {
      this.currentSlot = this.currentSlot.addn(1);
      return this.currentSlot;
    }
  }
}
