import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const {
  record,
  user,
  match,
  matchStageTimeRecord,
  win,
  playerHand,
  room
} = prisma

export default prisma
