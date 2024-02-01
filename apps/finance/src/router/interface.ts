export interface WithPaginationReq {
  current?: number
  pageSize?: number
}

export interface BizError {
  status?: number
  message?: string
}

export interface PrismaError {
  code: string
}

export interface Identity {
  id?: number
}

export interface RequestBody {
  [key: string]: string
}

export type TimeRange = [string, string]
