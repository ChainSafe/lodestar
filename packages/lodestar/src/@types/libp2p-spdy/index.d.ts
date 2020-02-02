// Type definitions for libp2p-spdy 0.12.1
// Project: https://github.com/libp2p/js-libp2p-spdy
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare namespace LibP2pSpdy {
  type Muxer = {};
}

declare type LibP2pSpdy = {
  (conn: any, isListener: boolean): LibP2pSpdy.Muxer;

  dialer (conn: any): LibP2pSpdy.Muxer;
  listener (conn: any): LibP2pSpdy.Muxer;

  muticodec: string;
};

declare module 'libp2p-spdy' {
const spdy: LibP2pSpdy;

export default spdy;
}
