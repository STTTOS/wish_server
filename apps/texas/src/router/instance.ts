import type { User } from '@prisma/texas-client'

import Router from 'koa-router'

export interface DefaultState {
  user?: Pick<User, 'id'> & { sessionId: string }
}
const router = new Router<DefaultState>()

export default router
