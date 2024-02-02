import type { EBookCategory } from '@prisma/blog-client'

import { WithPaginationReq } from '../interface'

export interface EBookLookUpList extends Required<WithPaginationReq> {
  name?: string
  category?: EBookCategory[]
}
