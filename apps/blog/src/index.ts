/* eslint-disable @typescript-eslint/no-var-requires */

const moduleAlias = require('module-alias')
const path = require('path')
// Or multiple aliases
moduleAlias.addAliases({
  '@': path.join(__dirname, '../src')
})
require('./start')
