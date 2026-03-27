import log4js from 'log4js'

// 全局日志入口：后续如需按 namespace/环境分流，在此集中配置。
log4js.configure({
  pm2: true,
  appenders: { out: { type: 'stdout' } },
  categories: { default: { appenders: ['out'], level: 'info' } }
})

const logger = log4js.getLogger()

export { logger }
