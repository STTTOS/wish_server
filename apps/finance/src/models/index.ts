import { PrismaClient } from '@prisma/finance-client'

const prisma = new PrismaClient()

export const { test } = prisma

export default prisma
