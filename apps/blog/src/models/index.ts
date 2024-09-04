import { PrismaClient } from '@prisma/blog-client'

const client = new PrismaClient()

const prisma = client.$extends({
  query: {
    article: {
      async $allOperations({ operation, args, query }) {
        if (
          operation === 'findUnique' ||
          operation === 'findFirst' ||
          operation === 'findMany'
        ) {
          // 默认查询未删除的数据
          args.where = { deletedAt: null, ...args.where }
        }
        return query(args)
      }
    }
  }
})
export const {
  user,
  article,
  tag,
  tagsOnArticles,
  tools,
  eBook,
  comment,
  message,
  timeline,
  moment,
  momentImages,
  momentLike
} = prisma

article.findMany
export default prisma
