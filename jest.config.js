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
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/build/"],
  transform: {
    "^.+.tsx?$": ["ts-jest",{}],
  },
};
