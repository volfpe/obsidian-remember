import { describe, expect, it } from 'vitest';
import { canCreateAndContinue } from './add-card-modal';

describe('canCreateAndContinue', () => {
	it('requires both basic fields to contain content', () => {
		expect(canCreateAndContinue({ id: 'card1', kind: 'basic', front: 'Question', back: 'Answer' })).toBe(true);
		expect(canCreateAndContinue({ id: 'card1', kind: 'basic', front: 'Question', back: '  ' })).toBe(false);
		expect(canCreateAndContinue({ id: 'card1', kind: 'basic' })).toBe(false);
	});

	it('does not treat the generated cloze placeholder as entered content', () => {
		expect(canCreateAndContinue({ id: 'card1', kind: 'cloze' })).toBe(false);
		expect(canCreateAndContinue({ id: 'card1', kind: 'cloze', body: '  ' })).toBe(false);
	});

	it('requires entered cloze content to contain a valid marker', () => {
		expect(canCreateAndContinue({ id: 'card1', kind: 'cloze', body: 'Water is ==c1:H₂O==.' })).toBe(true);
		expect(canCreateAndContinue({ id: 'card1', kind: 'cloze', body: 'Water is H₂O.' })).toBe(false);
	});
});
