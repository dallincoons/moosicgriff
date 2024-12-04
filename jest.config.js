/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  // moduleNameMapper: {
  //   'artists/(.*)': [
  //     '<rootDir>/artists/$1',
  //   ],
  // },
  "rootDir": "./",
  "roots": [
    "<rootDir>",
  ],
  "modulePaths": [
    "<rootDir>",
  ],
  "moduleDirectories": [
    "node_modules"
  ],
  // moduleDirectories: ['node_modules', '<rootDir>'],
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest",{}],
  },
};
