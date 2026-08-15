export default {
	extends: ['stylelint-config-standard'],
	ignoreFiles: ['node_modules/**'],
	plugins: ['stylelint-no-unsupported-browser-features'],
	rules: {
		'color-hex-length': 'long',
		'declaration-block-no-duplicate-properties': true,
		'declaration-no-important': true,
		// Obsidian 1.11.4's Electron 39 installer uses Chromium 142.
		'plugin/no-unsupported-browser-features': [
			true,
			{
				browsers: ['Chrome >= 142'],
			},
		],
		'selector-disallowed-list': [/:has\(/],
		'selector-type-no-unknown': true,
	},
};
