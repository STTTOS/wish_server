import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const {
  betRecord,
  user,
  match,
  matchStageTimeRecord,
  playerMatchRecord,
  room,
  roomMember,
  matchError
} = prisma

export default prisma
