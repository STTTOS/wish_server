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
