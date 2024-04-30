import { User } from '@prisma/client'

declare module 'koa' {
  interface ExtendableContext {
    userInfo: User
  }
}
