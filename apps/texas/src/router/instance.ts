import Router from 'koa-router'
import { User } from '@prisma/texas-client'

export interface DefaultState {
  user?: User & { sessionId: string }
}
const router = new Router<DefaultState>()

export default router
