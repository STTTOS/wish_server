import { Prisma } from '@prisma/roadsign-client'

import { HTTP_STATUS } from '../constants/httpStatus'

export function mapPrismaError(error: unknown): {
  status: number
  message: string
} | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null

  if (error.code === 'P2002') {
    return {
      status: HTTP_STATUS.CONFLICT,
      message: '数据与已有记录冲突，请检查是否重复'
    }
  }

  return null
}
