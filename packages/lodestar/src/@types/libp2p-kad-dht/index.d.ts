// Type definitions for libp2p-kad-dht 0.10.0
// Project: https://github.com/libp2p/js-libp2p-kad-dht
// Definitions by: Jaco Greeff <https://github.com/jacogr>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

declare class LibP2pKadDht {
  readonly isStarted: boolean;

  randomWalk: {
    start (queries?: number, period?: number, maxTimeout?: number): void;
    stop (): void;
  }
}

declare module 'libp2p-kad-dht' {
export default LibP2pKadDht;
}
