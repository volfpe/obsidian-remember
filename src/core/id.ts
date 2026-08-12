/** Random 64-bit id in base36, always 13 chars. */
export function randomId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	let n = 0n;
	for (const byte of bytes) n = (n << 8n) | BigInt(byte);
	return n.toString(36).padStart(13, '0');
}
