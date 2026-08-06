export type CosUploadLogger = {
  // 兼容 log4js / console 等可变参日志
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info: (...args: any[]) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn?: (...args: any[]) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: (...args: any[]) => void
}

export type CosUploadClientOptions = {
  secretId: string
  secretKey: string
  /** 默认 xuan-1313104191 */
  bucket?: string
  /** 默认 ap-chengdu */
  region?: string
  /** CDN / 自定义域名，默认 cos.wishufree.com */
  cosDomain?: string
  /** 本地临时目录（formidable 原图落盘） */
  staticDir: string
  /** 文件名分隔符，默认 __ */
  fileNameSplitter?: string
  /** JPEG 压缩质量比例 0~1，默认 0.3 */
  imageCompressRatio?: number
  logger?: CosUploadLogger
}

export type UploadedImageFile = {
  newFilename: string
  originalFilename: string | null
  filepath: string
  size: number
}

/** 内存上传（不落盘）：仅 sharp 后传 compressed */
export type UploadedImageBuffer = {
  newFilename: string
  originalFilename: string | null
  buffer: Buffer
  size: number
}

export type ProcessedImage = {
  url: string
  originalUrl: string
  filename: string | null
}

export type BatchProcessedImage = {
  items: ProcessedImage[]
  failures: { filename: string | null; message: string }[]
}
