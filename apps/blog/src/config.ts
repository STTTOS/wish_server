export const port = '7500'

export const apiPrefix = '/api'

export const timeFormat = 'yyyy-MM-DD HH:mm:ss'

export const timeFormatWithoutSeconds = 'yyyy-MM-DD HH:mm'

export const wordsToMinuteBaseNumber = 500

export const cacheTime = 30 * 24 * 60 * 60

export const imageCompressRatio = 0.3

export const fileNameSpliter = '__'

export const tokenValidatedTime = 30 * 24 * 60 * 60

export const ivLength = 16

// 记录需要用户身份的接口
export const apiNeededToAuth = [
  '/api/user/add',
  // '/api/user/update',
  '/api/user/delete',

  // '/api/article/add',
  // '/api/article/update',
  // '/api/article/delete',

  '/api/tag/add',
  '/api/tag/update',
  '/api/tag/delete',

  '/api/ebook/add',
  '/api/ebook/update',
  '/api/ebook/delete',

  '/api/tools/add',
  '/api/tools/update',
  '/api/tools/delete',

  '/api/common/upload_file',
  '/api/common/upload_image',
  '/api/common/upload_persistent',
  '/api/common//upload_temp_file',
  '/api/common/deploy_blog_frontend',

  '/api/storage/persistent/delete',

  // 系统消息推送
  '/api/system/sendNotify'
]
