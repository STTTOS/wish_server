/* eslint-disable @typescript-eslint/no-var-requires */

const moduleAlias = require('module-alias')
// Or multiple aliases
moduleAlias.addAliases({
  '@': __dirname
})
require('./start')
