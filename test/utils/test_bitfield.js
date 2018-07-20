const assert = require('chai').assert;

const {
	getBitfieldLength,
	getEmptyBitfield,
	hasVoted,
	setVoted,
} = require('../../lodestar_chain/utils/bitfield');

const attestBitfield = [
	[0, 0],
	[1, 1],
	[8, 1],
	[9, 2],
	[16, 2],
	[17, 3],
];

describe('Bitfield', () => {

	it('getBitfieldLength() should return the correct length', () => {
		for(let i=0; i < attestBitfield.length; i++) {
			const cur = attestBitfield[i];
			const length = getBitfieldLength(cur[0]);
			assert.equal(length, cur[1]);
		}
	});

	it('getEmptyBitfieldLength() should not have any voted', () => {
		const attesters = new Array(10);
		const bitfield = getEmptyBitfield(attesters.length);

		for (let attester in attesters) {
			assert.not(hasVoted(bitfield, attester));
		}
	});

	it('bitfield single votes', () => {
		const attesters = new Array(10);
		const bitfield = getEmptyBitfield(attesters.length);
		console.log(setVoted(bitfield, 0))
		setVoted(bitfield, 1)
		setVoted(bitfield, 2)
		setVoted(bitfield, 7)
		// assert.equal(setVoted(bitfield, 0), b'\x80\x00');
		// assert.equal(setVoted(bitfield, 1), b'\x40\x00');
		// assert.equal(setVoted(bitfield, 2), b'\x20\x00');
		// assert.equal(setVoted(bitfield, 7), b'\x01\x00');
		// assert.equal(setVoted(bitfield, 8), b'\x00\x80');
		// assert.equal(setVoted(bitfield, 9), b'\x00\x40');
	});

	it('bitfield all votes', () => {
		const attesters = new Array(10);

		let bitfield = getEmptyBitfield(attesters.length)
		for (let attester in attesters) {
			bitfield = setVoted(bitfield, attester)
		}

		for (let attester in attesters) {
			// assert.
		}
	});

	it('bitfield gets some votes', () => {
		const attesters = Array(10);
		const voters = [0, 4, 5, 9];

		let bitfield = getEmptyBitfield(attesters.length);
		for (let voter in voters) {
			bitfield = setVoted(bitfield, voter)
		}
		console.log(bitfield)
		assert.match(bitfield, '/\x8c\x40/'); // doesnt work

	});

	it('bitfield multiple votes', () => {
		let bitfield = getEmptyBitfield(0);
		bitfield = setVoted(bitfield, 0);
		bitfield = setVoted(bitfield, 0);
		assert.isTrue(hasVoted(bitfield, 0))
	});
});
