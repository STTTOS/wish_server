import Koa from 'koa'
import http from 'http'

import SocketServer from '../SockeServer'
import { registerRuntimeTeardownHooks } from '../router/game/services/registerRuntimeTeardownHooks'

const app = new Koa()

const server = http.createServer(app.callback())

const ws = new SocketServer()
registerRuntimeTeardownHooks({
  purgeRoomLocalState: (roomKey) => ws.purgeRoomLocalState(roomKey)
})

export { app, server, ws }
