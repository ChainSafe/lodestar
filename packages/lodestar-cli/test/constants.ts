import tmp from "tmp";

const tmpDir = tmp.dirSync({unsafeCleanup: true});

export const rootDir = tmpDir.name;
export const passphraseFile = "primary.pass";
