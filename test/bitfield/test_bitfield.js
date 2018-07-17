const expect = require('chai').expect;
const bitfield = require('../../lodestar_chain/utils/bitfield');

const attestBitfield = [
	[0, 0],
	[1, 1],
	[8, 1],
	[9, 2],
	[16, 2],
	[17, 3],
];

describe('hasVoted should export', () => {
	for(let i=0; i < attestBitfield.length; i++) {
		const cur = attestBitfield[i];
		expect(bitfield.getBitfieldLength(cur[i][0])).to.be.equal(cur[1])
	}
});
