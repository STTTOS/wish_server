import { PrismaClient } from '@prisma/gold-client'

const prisma = new PrismaClient()

export const { tick, dailyBar } = prisma

export default prisma
