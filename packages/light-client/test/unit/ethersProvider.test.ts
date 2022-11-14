import {expect} from "chai";
import {ethers} from "ethers";
import {LightclientRestProvider} from "../../src/ethersProvider.js";
import {ILightclient, RootResolver} from "../../src/rootResolver.js";

describe("ethersProvider LightclientRestProvider", () => {
  it("demo", async () => {
    const lightclient = todo() as ILightclient;
    const rootResolver = new RootResolver(lightclient);
    const provider = new LightclientRestProvider(rootResolver);

    const balance = await provider.getBalance("0xsampleaddress", "latest");
    expect(balance).equals(69420);

    const contract = new ethers.Contract("0xsamplecontract", "sample-abi", provider);
    const callResult = (await contract.functions.sampleCall()) as unknown;
    expect(callResult).equals(69420);
  });
});
