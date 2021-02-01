import {Lightclient, SignedBeaconBlock, BeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EMPTY_SIGNATURE} from "@chainsafe/lodestar-beacon-state-transition";

export type SignedBeaconBlockType = SignedBeaconBlock | Lightclient.SignedBeaconBlock;
export type BeaconBlockType = BeaconBlock | Lightclient.BeaconBlock;

export function getSignedBeaconBlockSSZTypeBySlot(
  config: IBeaconConfig,
  slot: Slot
): ContainerType<SignedBeaconBlockType> {
  if (slot < config.params.lightclient.LIGHTCLIENT_PATCH_FORK_SLOT) {
    return config.types.SignedBeaconBlock;
  } else {
    return config.types.lightclient.SignedBeaconBlock as ContainerType<SignedBeaconBlockType>;
  }
}

export function getSignedBeaconBlockSSZType(
  config: IBeaconConfig,
  block: SignedBeaconBlockType
): ContainerType<SignedBeaconBlockType> {
  return getSignedBeaconBlockSSZTypeBySlot(config, block.message.slot);
}

export function getBeaconBlockSSZType(config: IBeaconConfig, block: BeaconBlockType): ContainerType<BeaconBlockType> {
  return getSignedBeaconBlockSSZType(config, {message: block, signature: EMPTY_SIGNATURE}).fields
    .message as ContainerType<BeaconBlockType>;
}
