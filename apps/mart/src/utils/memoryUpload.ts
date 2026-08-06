import { Writable } from 'stream'

/**
 * formidable fileWriteStreamHandler：把上传内容收集到 file.buffer，不落盘。
 */
export function memoryFileWriteStreamHandler(file: {
  buffer?: Buffer
}): Writable {
  const chunks: Buffer[] = []
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      callback()
    },
    final(callback) {
      file.buffer = Buffer.concat(chunks)
      callback()
    }
  })
}
