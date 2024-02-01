// export const port = process.env.SERVER_PORT!
export const port = '5501'

export const apiPrefix = '/api'

export const timeFormat = 'yyyy-MM-DD HH:mm:ss'

export const timeFormatWithoutSeconds = 'yyyy-MM-DD HH:mm'

export const wordsToMinuteBaseNumber = 500

export const cacheTime = 30 * 24 * 60 * 60

export const secretKey = process.env.SECRET_KEY!

export const apiNeededToAuth = [
  '/api/user/add',
  '/api/user/update',
  '/api/user/delete',

  '/api/article/add',
  '/api/article/update',
  '/api/article/delete',

  '/api/tag/add',
  '/api/tag/update',
  '/api/tag/delete',

  '/api/ebook/add',
  '/api/ebook/update',
  '/api/ebook/delete',

  '/api/common/upload'
]
