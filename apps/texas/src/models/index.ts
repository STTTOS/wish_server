import { PrismaClient } from '@prisma/texas-client'

const prisma = new PrismaClient()

export const {
  betRecord,
  user,
  userSettings,
  announcement,
  announcementRead,
  match,
  matchDomainEvent,
  matchStageTimeRecord,
  playerMatchRecord,
  room,
  roomMember,
  roomChipTopUp,
  userRoomStat,
  matchError
} = prisma

export default prisma
