import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const {
  record,
  user,
  match,
  matchStageTimeRecord,
  win,
  playerHand,
  room,
  matchError
} = prisma

export default prisma
