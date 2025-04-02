import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const { record, user, match, matchStageTimeRecord, win, playerHand } =
  prisma

export default prisma
