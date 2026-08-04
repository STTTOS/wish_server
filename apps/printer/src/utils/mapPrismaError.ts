import { Prisma } from '@prisma/mart-client'

import { HTTP_STATUS } from '../constants/httpStatus'

/** 将常见 Prisma 错误映射为可展示给前端的业务文案 */
export function mapPrismaError(error: unknown): {
  status: number
  message: string
} | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null

  if (error.code === 'P2002') {
    const target = error.meta?.target
    const fields = Array.isArray(target)
      ? target.map(String).join(',')
      : String(target ?? '')

    if (/barcode/i.test(fields)) {
      return {
        status: HTTP_STATUS.CONFLICT,
        message: '该条码已绑定其他商品'
      }
    }
    if (/Category_name|name/i.test(fields) && /Category/i.test(fields)) {
      return {
        status: HTTP_STATUS.CONFLICT,
        message: '品类名称已存在'
      }
    }
    return {
      status: HTTP_STATUS.CONFLICT,
      message: '数据与已有记录冲突，请检查是否重复'
    }
  }

  return null
}
