// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
// Subject to change with future developments with Hobbits and wire protocol
import {ValidatorIndex, Slot} from "../src/types";

export default class RPCProvider {
  readonly rpcUrl: string;
  private validatorIndex: ValidatorIndex;
  private currentSlot: Slot;
  constructor(url: string) {
    this.rpcUrl = url;

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

  public getCurrentSlot(): Slot {
    if (!slot) {
      const slot = notSoRandomRandomSlot();
      this.currentSlot = slot;
      return slot;
    } else {
      this.currentSlot = this.currentSlot.addn(1);
      return this.currentSlot;
    }
  }
}


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
