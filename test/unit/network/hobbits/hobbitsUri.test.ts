import {HobbitsUri} from "../../../../src/network/hobbits/hobbitsUri";
import {expect} from "chai";

describe("[hobbits] Uri", ()=>{
  // TODO: Write uriString array and use for loop to match
  it('should be able to match the uri', function () {
    let uriString = "hob+tcp://af@10.0.0.1:9000";
    let uri = new HobbitsUri({uriString: uriString});
    expect(uri.toUri()).equals(uriString);
  });

  it('should not be able to generate correctly', function () {
    let uriString = "hob+tcp://af@10.0.0.1:9000:";
    let uri = new HobbitsUri({uriString: uriString});
    expect(uri.toUri()).to.be.null;
  });

  it('should be able to generate correct peerInfo', async function () {
    let uriString = "hob+tcp://10.0.0.1:9000";
    let hobbitsUri = new HobbitsUri({uriString: uriString});
    let peerInfo = await HobbitsUri.hobbitsUriToPeerInfo(hobbitsUri);
    console.log(peerInfo);

    let reverseUri = HobbitsUri.peerInfoToHobbitsUri(peerInfo);
    delete reverseUri.identity; // removed generated id

    console.log(hobbitsUri);
    console.log(reverseUri);
    expect(reverseUri).to.deep.equal(hobbitsUri);
  });
});