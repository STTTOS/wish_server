import { User } from '@prisma/blog-client'

// declare module 'koa' {
//   interface ParameterizedContext {
//     user?:number
//   }
// }
declare namespace Application {
  interface ParameterizedContext {
    user?: User
  }
}
