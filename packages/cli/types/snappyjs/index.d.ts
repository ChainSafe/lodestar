declare module "snappyjs" {
  export function compress<T extends ArrayBuffer | Buffer | Uint8Array>(input: T): T;
  export function uncompress<T extends ArrayBuffer | Buffer | Uint8Array>(input: T): T;
}
