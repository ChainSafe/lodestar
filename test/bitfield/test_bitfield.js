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

describe('Bitfield', () => {

	describe('getBitfieldLength should return the correct length', () => {
		for(let i=0; i < attestBitfield.length; i++) {
			const cur = attestBitfield[i];
			const length = bitfield.getBitfieldLength(cur[0]);
			expect(length).to.equal(cur[1]);
		}
	});
});
