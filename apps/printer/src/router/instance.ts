import Router from 'koa-router'

export interface DefaultState {
  user?: {
    id: number
    username: string
    shopCode: string
  }
}

const router = new Router<DefaultState>()

export default router
