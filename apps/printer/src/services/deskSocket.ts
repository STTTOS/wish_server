import type { Server as HttpServer } from 'http'
import { Server, type Socket } from 'socket.io'

import { logger } from '../logger'
import { decrypt } from '../utils/cryptor'
import { userRepository } from '../repositories/userRepository'

let io: Server | null = null

function getTokenFromHandshake(handshake: Socket['handshake']): string | null {
  const auth = handshake.auth
  if (auth && typeof auth === 'object' && 'token' in auth) {
    const authToken = (auth as { token?: unknown }).token
    if (typeof authToken === 'string' && authToken) return authToken
  }
  const queryToken = handshake.query.token
  if (typeof queryToken === 'string' && queryToken) return queryToken
  if (Array.isArray(queryToken) && typeof queryToken[0] === 'string') {
    return queryToken[0] || null
  }
  const authorizationHeader = handshake.headers.authorization
  if (
    typeof authorizationHeader === 'string' &&
    authorizationHeader.startsWith('Bearer ')
  ) {
    return authorizationHeader.slice(7).trim() || null
  }
  return null
}

export function attachDeskSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  })

  const desk = io.of('/desk')
  desk.use(async (socket, next) => {
    try {
      const token = getTokenFromHandshake(socket.handshake)
      if (!token) {
        next(new Error('unauthorized'))
        return
      }
      const payload = decrypt<{ id: number }>(token)
      const user = await userRepository.findAuthById(payload.id)
      if (!user) {
        next(new Error('unauthorized'))
        return
      }
      socket.data.user = user
      next()
    } catch (error) {
      logger.warn('[desk-ws] auth failed', error)
      next(new Error('unauthorized'))
    }
  })

  desk.on('connection', (socket) => {
    const user = socket.data.user as { shopCode: string; username: string }
    const room = `shop:${user.shopCode}`
    socket.join(room)
    logger.info(`[desk-ws] ${user.username} joined ${room}`)
    socket.on('disconnect', () => {
      logger.info(`[desk-ws] ${user.username} left ${room}`)
    })
  })

  return io
}

export function getDeskIo() {
  return io
}
