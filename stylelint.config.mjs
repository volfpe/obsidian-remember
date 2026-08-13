export default {
	extends: ['stylelint-config-standard'],
	ignoreFiles: ['node_modules/**'],
	rules: {
		'color-hex-length': 'long',
		'declaration-block-no-duplicate-properties': true,
		'declaration-no-important': true,
		'selector-disallowed-list': [/:has\(/],
		'selector-type-no-unknown': true,
	},
};
