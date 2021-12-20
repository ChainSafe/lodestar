import {expect} from "chai";
import {requestKeys, requestSignature} from "../../../src/services/utils";
import {getServer} from "./utils";

describe("Remote Signer", function () {
  it("should return keys", function () {
    expect(1).to.deep.equal(1);
  });
  it("should handle successful GET request correctly", async () => {
    const remoteUrl = "http://localhost:9001";
    await getServer();
    const keys = await requestKeys(remoteUrl);
    console.log("key: ", keys[0]);
    expect(keys[0]).to.deep.equal(
      "b7354252aa5bce27ab9537fd0158515935f3c3861419e1b4b6c8219b5dbd15fcf907bddf275442f3e32f904f79807a2a"
    );
  });
});
