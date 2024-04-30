import { User } from '@prisma/blog-client'

declare module 'koa' {
  interface ExtendableContext {
    userInfo: {
      data: User | null
      id: number
      tokenStatus: 'valid' | 'invalid' | 'expire'
    }
  }
}
