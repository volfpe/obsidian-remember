/** Random 64-bit id in base36, always 13 chars. */
export function randomId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let n = 0n;
	for (const byte of bytes) n = (n << 8n) | BigInt(byte);
	return n.toString(36).padStart(13, '0');
}

/** Time-sortable card id: 9 base36 timestamp chars followed by 7 random chars. */
export function newCardId(timestamp = Date.now(), random = randomUint32()): string {
	const timePart = timestamp.toString(36).padStart(CARD_ID_TIME_WIDTH, '0');
	const randomPart = random.toString(36).padStart(CARD_ID_RANDOM_WIDTH, '0');
	return timePart + randomPart;
}

function randomUint32(): number {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	let n = 0;
	for (const byte of bytes) n = (n * 256 + byte) >>> 0;
	return n;
}

const CARD_ID_TIME_WIDTH = 9;
const CARD_ID_RANDOM_WIDTH = 7;
