pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract ValidatorRegistration {

    event Deposit(
        bytes32 previousReceiptRoot,
        bytes data,
        uint depositCount
    );

    event Eth2Genesis(
        bytes32 receiptRoot,
        bytes time
    );

    uint public constant MAX_DEPOSIT_AMOUNT = 32 ether;
    uint public constant DEPOSITS_FOR_CHAIN_START = 8; // 2**14 in production
    uint public constant MIN_DEPOSIT_AMOUNT = 1 ether;
    uint public constant GWEI_PER_ETH = 10 ** 9;
    uint public constant DEPOSIT_CONTRACT_TREE_DEPTH = 32;
    uint public constant SECONDS_PER_DAY = 86400;

    mapping (uint => bytes32) public receiptTree;
    uint public depositCount;
    uint public totalDepositCount;

    function deposit(
        bytes memory depositParams
    )
        public
        payable
    {
        require(
            depositParams.length == 2048,
            "Deposit parameters must be 2048 bytes in length."
        );
        require(
            msg.value <= MAX_DEPOSIT_AMOUNT,
            "Deposit can't be greater than MAX_DEPOSIT_AMOUNT."
        );
        require(
            msg.value >= MIN_DEPOSIT_AMOUNT,
            "Deposit can't be lesser than MIN_DEPOSIT_AMOUNT."
        );

        uint index = depositCount + 2 ** DEPOSIT_CONTRACT_TREE_DEPTH;
        bytes memory msgGweiInBytes = toBytes(msg.value / GWEI_PER_ETH);
        bytes memory timeStampInBytes = toBytes(block.timestamp);
        bytes memory depositData = abi.encodePacked(msgGweiInBytes, timeStampInBytes, depositParams);
        require(
            depositData.length == 2064,
            "Message Gwei and block timestamp bytes improperly sliced."
        );

        emit Deposit(receiptTree[1], depositData, depositCount);

        receiptTree[index] = keccak256(depositData);
        for (uint i = 0; i < DEPOSIT_CONTRACT_TREE_DEPTH; i++) {
            index = index / 2;
            receiptTree[index] = keccak256(abi.encodePacked(receiptTree[index * 2], receiptTree[index * 2 + 1]));
        }

        depositCount++;
        if (msg.value == MAX_DEPOSIT_AMOUNT) {
            totalDepositCount++;
            if (totalDepositCount == DEPOSITS_FOR_CHAIN_START) {
                uint timestampDayBoundary = block.timestamp - block.timestamp % SECONDS_PER_DAY + SECONDS_PER_DAY;
                bytes memory timestampDayBoundaryBytes = toBytes(timestampDayBoundary);
                emit Eth2Genesis(receiptTree[1], timestampDayBoundaryBytes);
            }
        }
    }

    function getReceiptRoot() public view returns (bytes32) {
        return receiptTree[1];
    }

    // Gets last 8 bytes of uint256
    function toBytes(uint x) private pure returns (bytes memory) {
        bytes memory b = new bytes(32);
        assembly {
          mstore(add(b, 32), x)
        }
        bytes memory c = new bytes(8);
        for(uint8 i = 24; i < 32; i++){
            c[i - 24] = b[i];
        }
        return c;
    }
}
