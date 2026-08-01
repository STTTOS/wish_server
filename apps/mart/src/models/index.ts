import { PrismaClient } from '@prisma/mart-client'

const prisma = new PrismaClient()

export const { user, category, product } = prisma

export default prisma
