import net from "net";
import {EventEmitter} from "events";
import {Events} from './types';

export interface PeerOpts {
  ip: string;
  port: number;
}

export default class Peer extends EventEmitter {
  public ip: string;
  public port?: number;
  public connection: net.Socket;

  /**
   * Constructor
   * @param {PeerOpts} opts
   */
  public constructor(opts: PeerOpts) {
    super();
    this.ip = opts.ip;
    this.port = opts.port || 9000;
  }

  /**
   * Establishes a connection to the peer.
   * @returns {boolean}
   */
  public connect = (): Promise<boolean> => {
    // Attempt to connect to peer, if connection refused remove the peer from bootnodes.
    const that = this;
    return new Promise((resolve, reject): void => {
      that.connection = net.createConnection({port: this.port});
      that.connection.on('connect', resolve);
      that.connection.on('error', reject);
    });
  };

  /**
   * Starts listening for incoming messages from the server
   */
  public start = (): void => {
    this.connection.on('data', (data): void => {
      this.emit(Events.NewData, data.toString());
      this.connection.end();
    });

    this.connection.on('end', (): void => {
      this.disconnect();
    });
  };

  /**
   * Destroys the connection to the peer.
   * @returns {Promise<void>}
   */
  public disconnect = async (): Promise<void> => {
    this.emit(Events.Status,"Disconnecting from server!");	  
    await this.connection.destroy();
  };
}
