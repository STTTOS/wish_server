import type { Role } from '@prisma/mart-client'

import { user } from '../models'

export type AuthUser = {
  id: number
  username: string
  role: Role
}

/** Repository：用户持久化访问 */
export const userRepository = {
  findByUsername(username: string) {
    return user.findUnique({ where: { username } })
  },

  findAuthById(id: number): Promise<AuthUser | null> {
    return user.findUnique({
      where: { id },
      select: { id: true, role: true, username: true }
    })
  },

  upsertSeed(input: { username: string; password: string; role: Role }) {
    return user.upsert({
      where: { username: input.username },
      create: {
        username: input.username,
        password: input.password,
        role: input.role
      },
      update: {
        password: input.password,
        role: input.role
      }
    })
  }
}
