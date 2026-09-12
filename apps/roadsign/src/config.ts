export const port = process.env.SERVER_PORT || '7505'

export const apiPrefix = '/api'

export const cacheTime = 30 * 24 * 60 * 60

export const roadsignApiToken = (process.env.ROADSIGN_API_TOKEN || '').trim()

/** 高德 Web 服务 Key（静态地图）；未配置时导出回退到网格示意图 */
export const amapWebKey = (process.env.AMAP_WEB_KEY || '').trim()
