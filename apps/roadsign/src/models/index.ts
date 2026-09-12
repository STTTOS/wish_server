import { PrismaClient } from '@prisma/roadsign-client'

const prisma = new PrismaClient()

export const { roadSign } = prisma

export default prisma
