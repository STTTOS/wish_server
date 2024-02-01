import type { WithPaginationReq } from '../interface'

export type GetArticleFilterType = 'hotest' | 'newest'

export interface GetArticleReq {
  title?: string
  tagIds?: number[]
  authorIds?: number[]
  // 时间范围筛选
  time?: [string, string]
  filterType?: GetArticleFilterType
}
export type GetArticleByPaginationReq = GetArticleReq & WithPaginationReq
