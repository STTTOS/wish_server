import { Writable } from 'stream'

type FileLike = {
  newFilename?: string
  buffer?: Buffer
}

const byObject = new WeakMap<object, Buffer>()
/** 防 koa-body 将来若拷贝/序列化 file 对象导致丢 buffer；按 newFilename 暂存并 take 后删除 */
const byNewFilename = new Map<string, { buffer: Buffer; at: number }>()

const PENDING_TTL_MS = 5 * 60 * 1000

function prunePending(now = Date.now()) {
  for (const [key, value] of byNewFilename) {
    if (now - value.at > PENDING_TTL_MS) byNewFilename.delete(key)
  }
}

/**
 * formidable fileWriteStreamHandler：收集到内存，不落盘。
 * 同时写入 file.buffer、WeakMap、以及按 newFilename 的短时 Map，避免中间件改写 file 后读不到内容。
 */
export function memoryFileWriteStreamHandler(file: FileLike): Writable {
  const chunks: Buffer[] = []
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      callback()
    },
    final(callback) {
      const buffer = Buffer.concat(chunks)
      file.buffer = buffer
      byObject.set(file as object, buffer)
      if (file.newFilename) {
        prunePending()
        byNewFilename.set(file.newFilename, { buffer, at: Date.now() })
      }
      callback()
    }
  })
}

/** 取出上传 buffer（优先 file.buffer → WeakMap → newFilename 暂存），取后清掉 Map 项 */
export function takeMemoryUploadBuffer(
  file: FileLike | null | undefined
): Buffer | null {
  if (!file) return null

  const fromProp = file.buffer
  if (fromProp?.length) {
    if (file.newFilename) byNewFilename.delete(file.newFilename)
    return fromProp
  }

  const fromWeak = byObject.get(file as object)
  if (fromWeak?.length) {
    if (file.newFilename) byNewFilename.delete(file.newFilename)
    return fromWeak
  }

  if (file.newFilename) {
    const pending = byNewFilename.get(file.newFilename)
    if (pending?.buffer.length) {
      byNewFilename.delete(file.newFilename)
      return pending.buffer
    }
  }

  return null
}
