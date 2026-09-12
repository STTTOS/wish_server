import { PrismaClient } from '@prisma/roadsign-client'

const prisma = new PrismaClient()

export const { roadSign, road } = prisma

export default prisma
