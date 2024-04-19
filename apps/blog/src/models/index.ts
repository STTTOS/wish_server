import { PrismaClient } from '@prisma/blog-client'

const prisma = new PrismaClient()

export const {
  user,
  article,
  tag,
  tagsOnArticles,
  tools,
  eBook,
  comment,
  message
} = prisma

export default prisma
