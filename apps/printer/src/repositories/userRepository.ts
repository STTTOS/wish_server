import { user } from '../models'

export type AuthUser = {
  id: number
  username: string
  shopCode: string
}

export const userRepository = {
  findByUsername(username: string) {
    return user.findUnique({ where: { username } })
  },

  findAuthById(id: number): Promise<AuthUser | null> {
    return user.findUnique({
      where: { id },
      select: { id: true, username: true, shopCode: true }
    })
  },

  /** 公开上传：仅允许已绑定店员账号的 shopCode */
  async existsByShopCode(shopCode: string): Promise<boolean> {
    const row = await user.findFirst({
      where: { shopCode },
      select: { id: true }
    })
    return row != null
  },

  upsertSeed(input: {
    username: string
    password: string
    shopCode: string
  }) {
    return user.upsert({
      where: { username: input.username },
      create: {
        username: input.username,
        password: input.password,
        shopCode: input.shopCode
      },
      update: {
        password: input.password,
        shopCode: input.shopCode
      }
    })
  }
}
