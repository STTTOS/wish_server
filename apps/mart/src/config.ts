export const port = process.env.SERVER_PORT || '7502'

export const apiPrefix = '/api'

export const timeFormat = 'YYYY-MM-DD HH:mm:ss'

export const cacheTime = 30 * 24 * 60 * 60

export const tokenValidatedTime = 30 * 24 * 60 * 60

/** 系统默认品类名：新建商品未指定品类时使用 */
export const DEFAULT_CATEGORY_NAME = '未分类'

/** 新建商品默认库存 */
export const DEFAULT_PRODUCT_STOCK = 9999

/** blog 服务地址（图片上传转发） */
export const blogBaseUrl = process.env.BLOG_BASE_URL || 'http://localhost:7500'

/** blog JWT 密钥（与 apps/blog 的 SECRET_KEY 一致） */
export const blogSecretKey = process.env.BLOG_SECRET_KEY || ''

/** blog 管理员用户 id（用于签发上传凭证） */
export const blogAdminUserId = Number(process.env.BLOG_ADMIN_USER_ID || '0')
