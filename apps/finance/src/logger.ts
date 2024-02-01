import log4js from 'log4js'

// TODO: 日志组件使用
log4js.configure({
  pm2: true,
  appenders: { out: { type: 'stdout' } },
  categories: { default: { appenders: ['out'], level: 'info' } }
})

const logger = log4js.getLogger()

export { logger }
