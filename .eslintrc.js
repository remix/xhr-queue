module.exports = {
  extends: ['prettier', 'airbnb-base/legacy'],
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': ['warn', { singleQuote: true, printWidth: 100 }],
    'vars-on-top': 0,
    'func-names': 0,
    'space-before-function-paren': 0,
    'no-plusplus': 0,
    'function-paren-newline': 0,
    'no-mixed-operators': 0,
    'operator-linebreak': 0,
  },
  globals: {
    'Promise': false,
  }
};
