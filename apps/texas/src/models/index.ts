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
  engineFatalIncident,
  assetUsageEvent,
  userDailyFortune,
  itemDefinition,
  userItemBalance,
  userItemLedger,
  userMail,
  userMailAttachment,
  playerStyleStat,
  playerHonorsStat,
  stylePopulationStat,
  styleStatAppliedHand,
  disciplineActionSnapshot,
  disciplineAppliedHand,
  playerDisciplineStat,
  profileHighlight,
  profileGuestbookMessage
} = prisma

export default prisma
