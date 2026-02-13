/* eslint-env node */
module.exports = {
  root: true,
  extends: [
    'plugin:vue/vue3-essential',
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'off',
    'no-unused-vars': 1
  },
  env: {
    browser: true,
    node: true,
    es2022: true,
    'vue/setup-compiler-macros': true
  },
  globals: {
    gtag: 'readonly',
    define: 'readonly'
  },
  overrides: [
    {
      files: ['src/components/vue3-color/**/*.{vue,js}'],
      rules: {
        'vue/multi-word-component-names': 'off'
      }
    },
    {
      files: ['src/proto/**/*.js'],
      env: {
        node: true
      }
    },
    {
      files: ['babel.config.js'],
      env: {
        node: true
      }
    }
  ]
}