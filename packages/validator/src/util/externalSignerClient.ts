import {
  ApiClient,
  ForkInfo,
  SignRequest,
  SignableMessage,
  SignableMessageType,
  getClient,
  requiresForkInfo,
} from "@lodestar/api/signer";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {BLSSignature, Root, Slot} from "@lodestar/types";
import {PubkeyHex} from "../types.js";

export type {SignableMessage};
export {SignableMessageType};

const clientByUrl = new Map<string, ApiClient>();

function getSignerClient(externalSignerUrl: string): ApiClient {
  let client = clientByUrl.get(externalSignerUrl);
  if (client === undefined) {
    client = getClient({baseUrl: externalSignerUrl});
    clientByUrl.set(externalSignerUrl, client);
  }
  return client;
}

/**
 * Return public keys from the server.
 */
export async function externalSignerGetKeys(externalSignerUrl: string): Promise<string[]> {
  return (await getSignerClient(externalSignerUrl).listPublicKeys()).value();
}

/**
 * Return signature in bytes. Assumption that the pubkey has it's corresponding secret key in the keystore of an external signer.
 */
export async function externalSignerPostSignature(
  config: BeaconConfig,
  externalSignerUrl: string,
  pubkeyHex: PubkeyHex,
  signingRoot: Root,
  signingSlot: Slot,
  signableMessage: SignableMessage
): Promise<BLSSignature> {
  const request: SignRequest = {pubkey: pubkeyHex, signingRoot, message: signableMessage};

  if (requiresForkInfo[signableMessage.type]) {
    request.forkInfo = getForkInfoForSigning(config, signingSlot, signableMessage.type);
  }

  return (await getSignerClient(externalSignerUrl).sign(request)).value().signature;
}

/**
 * Return upcheck status from server.
 */
export async function externalSignerUpCheck(remoteUrl: string): Promise<boolean> {
  return (await getSignerClient(remoteUrl).upcheck()).value().status === "OK";
}

function getForkInfoForSigning(config: BeaconConfig, signingSlot: Slot, messageType: SignableMessageType): ForkInfo {
  const forkInfo = config.getForkInfo(signingSlot);

  // Always uses Capella fork post-Deneb (EIP-7044)
  const {version, prevVersion, epoch} =
    messageType === SignableMessageType.VOLUNTARY_EXIT && isForkPostDeneb(forkInfo.name)
      ? config.forks[ForkName.capella]
      : {version: forkInfo.version, prevVersion: forkInfo.prevVersion, epoch: computeEpochAtSlot(signingSlot)};

  return {
    fork: {previousVersion: prevVersion, currentVersion: version, epoch},
    genesisValidatorsRoot: config.genesisValidatorsRoot,
  };
}
