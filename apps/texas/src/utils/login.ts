import { pick } from 'ramda'
import { User } from 'texas-poker-core'

import { encrypt } from './cryptor'

export function getToken(payload: Pick<User, 'id'> & { sessionId: string }) {
  const token = encrypt(pick(['id', 'sessionId'])(payload))

  return token
}
