import type { WithPaginationReq } from '../interface'

import { Prisma } from '@prisma/blog-client'

export type AddTimelineInput = Prisma.TimelineCreateInput & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  moment: any
}
export type FindTimelineInput = {
  userId: number
  id: number
  lastTimestamp?: string
} & WithPaginationReq
