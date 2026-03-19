import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const {
  betRecord,
  user,
  userSettings,
  match,
  matchStageTimeRecord,
  playerMatchRecord,
  room,
  roomMember,
  userRoomStat,
  matchError
} = prisma

export default prisma
