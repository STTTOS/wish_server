import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const { record, user, match, matchStageTimeRecord } = prisma

export default prisma
