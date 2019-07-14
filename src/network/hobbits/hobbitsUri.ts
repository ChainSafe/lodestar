/**
 * @module network/hobbits
 */

import PeerInfo from "peer-info";
import {peerInfoToAddress, validateHobbitsUri} from "./util";
import {promisify} from "util";

export interface IHobbitsUriOpts {
  scheme?: string;
  identity?: string;
  host?: string;
  port?: number;
  uriString?: string;
}

export class HobbitsUri {
  public scheme: string;
  public identity: string;
  public host: string;
  public port: number;
  public constructor(opts?: IHobbitsUriOpts) {
    if(opts.uriString) {
      const parsedUri = validateHobbitsUri(opts.uriString);
      if (parsedUri) {
        this.scheme = parsedUri.scheme;
        this.identity = parsedUri.identity;
        this.host = parsedUri.host;
        this.port = parsedUri.port;
      }
    }
    else {
      this.scheme = opts.scheme;
      this.identity = opts.identity;
      this.host = opts.host;
      this.port = opts.port;
    }
  }

  public toUri(): string{
    if(this.scheme){
      if(this.identity){
        return `hob+${this.scheme}://${this.identity}@${this.host}:${this.port}`;
      } else {
        return `hob+${this.scheme}://${this.host}:${this.port}`;
      }
    }
    return null;
  }

  public static peerInfoToHobbitsUri(peerInfo: PeerInfo): HobbitsUri{
    let nodeAddress = peerInfoToAddress(peerInfo);
    let opts: IHobbitsUriOpts = {
      scheme: nodeAddress.protoNames()[1],
      identity: peerInfo.id.toHexString(),
      host: nodeAddress.nodeAddress().address,
      port: parseInt(nodeAddress.nodeAddress().port)
    };
    return new HobbitsUri(opts);
  }

  public static async hobbitsUriToPeerInfo(hobbitsUri: HobbitsUri): Promise<PeerInfo> {
    let peerInfo: PeerInfo;
    let addr = `/ip4/${hobbitsUri.host}/${hobbitsUri.scheme}/${hobbitsUri.port}`;
    if(hobbitsUri.identity){
      let peerId = PeerId.createFromHexString(hobbitsUri.identity);
      peerInfo = await promisify(PeerInfo.create.bind(this))(peerId);
    } else {
      peerInfo = await promisify(PeerInfo.create.bind(this))();
    }

    peerInfo.multiaddrs.add(addr);
    return peerInfo;
  }
}