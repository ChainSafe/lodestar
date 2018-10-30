var ValidatorRegistration = artifacts.require('ValidatorRegistration');

function watchEvents(contract) {
    var events = contract.allEvents({fromBlock: 0, toBlock: 'latest'});

    console.log("contract events:\n");
    events.watch(function(error, result){
        console.log(result);
    });
}

contract('ValidatorRegistration', function(accounts) {

  var addressA = web3.eth.accounts[0];
  var addressB = web3.eth.accounts[1];
  var addressC = web3.eth.accounts[2];
  var addressD = web3.eth.accounts[3];

  web3.eth.defaultAccount = web3.eth.accounts[0];

  var validatorRegistration;

  it('should initialize a ValidatorRegistration contract', async() => {
    validatorRegistration = await ValidatorRegistration.new();

    assert(validatorRegistration !== undefined, "ValidatorRegistration contract has not been instantiated");
  });

  it('should successfully make a deposit and emit an event', async() => {
    var events = validatorRegistration.allEvents({fromBlock: 0, toBlock: 'latest'});

    events.watch(function(error, result) {
        console.log(result);
    });

    let blockHeader = await web3.eth.getBlock('latest');

    let depositHash = await validatorRegistration.deposit(addressA, 43, addressB, addressA, {from: addressA, value: web3.toWei(32, "ether")});
    let depositRes = await validatorRegistration.deposit.call(addressA, 43, addressB, addressA, {from: addressA, value: web3.toWei(32, "ether")});

    let depositReceipt = await web3.eth.getTransactionReceipt(depositHash.receipt.transactionHash);
    console.log(depositReceipt);



  });

});
