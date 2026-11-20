import assert from 'node:assert/strict'
import test from 'node:test'

import { hashPassword, verifyPassword } from './password'

test('verifyPassword accepts valid hash', () => {
  const stored = hashPassword('831902')
  assert.equal(verifyPassword('831902', stored), true)
  assert.equal(verifyPassword('wrong', stored), false)
})
