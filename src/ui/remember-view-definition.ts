import { STRINGS } from '../i18n';
import type { TransientSingletonViewDefinition } from './transient-singleton-view-host';

export const REMEMBER_VIEW_DEFINITION = {
	type: 'remember-review',
	displayText: STRINGS.plugin.viewTitle,
	icon: 'brain',
} as const satisfies TransientSingletonViewDefinition;
