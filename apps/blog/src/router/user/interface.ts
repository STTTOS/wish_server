import type { Identity, TimeRange, WithPaginationReq } from '../interface'

export interface GetUserReq {
  name?: string
  email?: string
  time?: TimeRange
}
export type GetUserByPaginationReq = GetUserReq & WithPaginationReq

export type UpdateUserReq = Identity & {
  name: string
  [key: string]: string
}
