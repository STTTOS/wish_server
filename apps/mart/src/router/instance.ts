import type { Role } from '@prisma/mart-client'

import Router from 'koa-router'

export interface DefaultState {
  user?: {
    id: number
    role: Role
    username: string
  }
}

const router = new Router<DefaultState>()

export default router
