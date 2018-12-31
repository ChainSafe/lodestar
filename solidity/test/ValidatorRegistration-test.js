const registrationContract = artifacts.require('ValidatorRegistration');

const DEPOSIT_AMOUNT = web3.utils.toWei('32', 'ether')
const MIN_TOPUP_AMOUNT = web3.utils.toWei('1', 'ether')
// Make a 32 byte digest 64 times to satisfy 2048 byte deposit size
let rawDepositData = ''
for (let i = 0; i < 64; i++) {
  rawDepositData = rawDepositData + web3.utils.sha3('@aunyks').slice(2)
}
const DEPOSIT_DATA = '0x' + rawDepositData

const assertRevert = async tx => {
  try {
    await tx()
  } catch (error) {
    assert(
      error.message.includes('revert'),
      `Expected "revert", got ${error} instead`
    );
    return
  }
  assert(false, 'Expected reversion not received')
}

const inLogs = (logs, eventName, eventArgs = {}) => {
  const event = logs.find(e => e.event === eventName);
  assert(event !== undefined, `Event ${eventName} was never emitted.`)
  let count = 0
  for (const [k, v] of Object.entries(eventArgs)) {
    if (event.args[k] !== undefined && event.args[k] === v) {
      count++
    }
  }
  assert(count >= 1 || Object.entries(eventArgs).length === 0, `Event ${eventName} not found with requested data.`)
  return event
}

const inTransaction = async (tx, eventName, eventArgs = {}) => {
  const { logs } = await tx()
  return inLogs(logs, eventName, eventArgs)
}

contract('ValidatorRegistration', accounts => {
  beforeEach(async () => {
    this.depositAddress = accounts[0]
    web3.eth.defaultAccount = this.depositAddress
    this.contract = await registrationContract.new();
  })

  it('initializes a Validator Registration contract', () => {
    assert(registrationContract !== undefined, "Contract couldn't be instantiated");
  })

  it('fails on deposit less than the topup amount', async () => {
    const depositTxion = this.contract.deposit.bind(this.contract, DEPOSIT_DATA, {
      from: this.depositAddress,
      value: web3.utils.toWei('0.9', 'ether')
    });
    await assertRevert(depositTxion)
  })

  it('fails on deposit more than 32 ETH', async () => {
    const depositTxion = this.contract.deposit.bind(this.contract, DEPOSIT_DATA, {
      from: this.depositAddress,
      value: web3.utils.toWei('33', 'ether')
    })
    await assertRevert(depositTxion)
  })

  it('successfully makes a 32 ETH deposit', async () => {
    await this.contract.deposit(DEPOSIT_DATA, {
      from: this.depositAddress,
      value: DEPOSIT_AMOUNT,
    })
  })

  it('properly emits Eth1Deposit event', async () => {
    const depositTxion = this.contract.deposit.bind(this.contract, DEPOSIT_DATA, {
      from: this.depositAddress,
      value: DEPOSIT_AMOUNT
    })
    await inTransaction(depositTxion, 'Eth1Deposit')
  })

  it('properly emits ChainStart event', async () => {
    let i
    for (i = 0; i < 7; i++) {
      await this.contract.deposit(DEPOSIT_DATA, {
        from: accounts[i],
        value: DEPOSIT_AMOUNT,
      })
    }
    const depositTxion = this.contract.deposit.bind(this.contract, DEPOSIT_DATA, {
      from: accounts[i + 1],
      value: DEPOSIT_AMOUNT
    })
    await inTransaction(depositTxion, 'ChainStart')
  })
});
