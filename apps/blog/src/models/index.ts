import { PrismaClient } from '@prisma/blog-client'

const prisma = new PrismaClient()

export const { user, article, tag, tagsOnArticles, tools, eBook } = prisma

export default prisma
