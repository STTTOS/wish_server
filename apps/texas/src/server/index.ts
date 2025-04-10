import Koa from 'koa'
import http from 'http'

import SocketServer from '../SockeServer'

const app = new Koa()

const server = http.createServer(app.callback())

const ws = new SocketServer()

export { app, server, ws }
