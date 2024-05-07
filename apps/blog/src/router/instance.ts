import type { User } from '@prisma/blog-client'

import Router from 'koa-router'

export interface DefaultState {
  user?: User
}
const router = new Router<DefaultState>()

export default router
