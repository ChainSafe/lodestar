declare module 'bcrypto/lib/sha256' {
  export default class SHA256 {

    public init(): SHA256;

    public update(data: Buffer): SHA256;

    public final(): Buffer;

  }
}
