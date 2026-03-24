import dayjs from 'dayjs'

import { timeFormat } from '../config'

export type LoginSession = {
  sessionId: string
  time: string
}

export type LoginScope = 'client' | 'web'

const loginUsersClient = new Map<number, LoginSession>()
const loginUsersWeb = new Map<number, LoginSession>()

const getStore = (scope: LoginScope) => {
  return scope === 'client' ? loginUsersClient : loginUsersWeb
}

export const getLoginSession = (userId: number, scope: LoginScope) => {
  return getStore(scope).get(userId)
}

export const setLoginSession = (
  userId: number,
  sessionId: string,
  scope: LoginScope
) => {
  getStore(scope).set(userId, {
    sessionId,
    time: dayjs().format(timeFormat)
  })
}

export const clearLoginSession = (userId: number, scope: LoginScope) => {
  getStore(scope).delete(userId)
}
