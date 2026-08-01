export const port = process.env.SERVER_PORT || '7502'

export const apiPrefix = '/api'

export const timeFormat = 'YYYY-MM-DD HH:mm:ss'

export const cacheTime = 30 * 24 * 60 * 60

export const tokenValidatedTime = 30 * 24 * 60 * 60

/** 系统默认品类名：新建商品未指定品类时使用 */
export const DEFAULT_CATEGORY_NAME = '未分类'

/** 新建商品默认库存 */
export const DEFAULT_PRODUCT_STOCK = 9999
