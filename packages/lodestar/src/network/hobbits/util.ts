/**
 * @module network/hobbits
 */

import PeerInfo from "peer-info";
import {Multiaddr} from "multiaddr";
import {RequestId} from "./constants";
import {promisify} from "util";
import * as net from "net";
import _ from "lodash";
import {HobbitsValidatedUri} from "./types";

function randomNibble(): string {
  return Math.floor(Math.random() * 16).toString(16);
}

export function randomRequestId(): RequestId {
  return parseInt(Array.from({length: 16}, () => randomNibble()).join(''));
}

export function peerInfoToAddress(peerInfo: PeerInfo): Multiaddr {
  let addrs = peerInfo.multiaddrs.toArray();
  if(addrs.length == 0){
    throw Error("Invalid PeerInfo instance");
  }
  return addrs[0];
}

export function validateHobbitsUri(uriString: string): HobbitsValidatedUri {
  // TODO: More validation on identity, host, port
  let regx = /^hob\+(tcp|udp):\/\/(?:([0-9a-f]*)@)?([a-zA-Z0-9.]*):([0-9]+)$/g;
  let match = regx.exec(uriString);
  if (match) {
    return {
      scheme: match[1],
      identity: match[2],
      host: match[3],
      port: parseInt(match[4])
    };
  }
  return null;
}

export async function hobbitsUriToPeerInfo(uriString: string): Promise<PeerInfo> {
  // validate uri
  const parsedUri = validateHobbitsUri(uriString);
  if (parsedUri) {
    // generate peerInfo from parsed data
    let peerInfo: PeerInfo;
    let addr = `/ip4/${parsedUri.host}/${parsedUri.scheme}/${parsedUri.port}`;
    if (parsedUri.identity) {
      let peerId = PeerId.createFromHexString(parsedUri.identity);
      peerInfo = await promisify(PeerInfo.create.bind(this))(peerId);
    } else {
      peerInfo = await promisify(PeerInfo.create.bind(this))();
    }

    peerInfo.multiaddrs.add(addr);
    return peerInfo;
  }

  return null;
}


export async function socketConnectionToPeerInfo(connection: net.Socket): Promise<PeerInfo> {
  let peerInfo: PeerInfo;
  let addr = `/ip4/${connection.remoteAddress}/tcp/${connection.remotePort}`;
  peerInfo = await promisify(PeerInfo.create.bind(this))();
  peerInfo.multiaddrs.add(addr);
  return peerInfo;
}


export function toSnakeCase(obj: any): any{
  _.mapKeys(obj, (v, k) => _.camelCase(k));
}

export function toCamelCase(obj: any): any{
  _.mapKeys(obj, (v, k) => _.camelCase(k));
}