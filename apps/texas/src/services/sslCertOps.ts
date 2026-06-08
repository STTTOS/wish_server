import { promisify } from 'util'
import { execFile } from 'child_process'
import { join, extname, basename } from 'path'
import { chmod, mkdir, unlink, copyFile, readFile } from 'fs/promises'

import { logger } from '../logger'

const execFileAsync = promisify(execFile)

const NGINX_DIR = process.env.SSL_NGINX_DIR || '/etc/nginx'
const NGINX_BIN = process.env.NGINX_BIN || 'nginx'
const ALLOWED_EXTENSIONS = new Set(['.key', '.crt', '.pem'])
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024

export type UploadedSslFile = {
  filepath: string
  originalFilename: string | null
  size: number
}

export class SslCertOpsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SslCertOpsError'
  }
}

const validateFilename = (filename: string): string => {
  const name = basename(filename.trim())
  if (!name || name.includes('..')) {
    throw new SslCertOpsError('非法文件名')
  }
  const ext = extname(name).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new SslCertOpsError(`不支持的文件类型: ${ext || '(无扩展名)'}`)
  }
  return name
}

const validatePemContent = async (
  filepath: string,
  ext: string
): Promise<void> => {
  const content = await readFile(filepath, 'utf8')
  if (!content.includes('-----BEGIN') || !content.includes('-----END')) {
    throw new SslCertOpsError('文件不是有效的 PEM 格式')
  }
  if (ext === '.key') {
    if (!content.includes('PRIVATE KEY')) {
      throw new SslCertOpsError('私钥文件格式无效')
    }
    return
  }
  if (!content.includes('CERTIFICATE')) {
    throw new SslCertOpsError('证书文件格式无效')
  }
}

const cleanupTempFile = async (filepath: string) => {
  try {
    await unlink(filepath)
  } catch {
    /* ignore */
  }
}

export const uploadSslFiles = async (files: UploadedSslFile[]) => {
  if (files.length === 0) {
    throw new SslCertOpsError('请至少上传一个 .key 或 .crt 文件')
  }

  await mkdir(NGINX_DIR, { recursive: true })

  const written: string[] = []
  for (const file of files) {
    const name = validateFilename(file.originalFilename || '')
    const ext = extname(name).toLowerCase()

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new SslCertOpsError(`${name} 超过 2MB 大小限制`)
    }

    await validatePemContent(file.filepath, ext)

    const dest = join(NGINX_DIR, name)
    await copyFile(file.filepath, dest)
    await chmod(dest, ext === '.key' ? 0o600 : 0o644)

    written.push(dest)
    await cleanupTempFile(file.filepath)
  }

  logger.info(`[ssl-cert] uploaded ${written.length} file(s) to ${NGINX_DIR}`)
  return { dir: NGINX_DIR, files: written }
}

export const runNginxTest = async () => {
  try {
    const { stdout, stderr } = await execFileAsync(NGINX_BIN, ['-t'])
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    logger.info(`[nginx] test ok: ${output}`)
    return { ok: true as const, output }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
    }
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    logger.warn(`[nginx] test failed: ${output || err.message}`)
    throw new SslCertOpsError(output || err.message || 'nginx -t 执行失败')
  }
}

export const runNginxReload = async () => {
  await runNginxTest()
  try {
    const { stdout, stderr } = await execFileAsync(NGINX_BIN, ['-s', 'reload'])
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    logger.info(`[nginx] reload ok: ${output || '(no output)'}`)
    return { ok: true as const, output: output || 'reload 成功' }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
    }
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    logger.warn(`[nginx] reload failed: ${output || err.message}`)
    throw new SslCertOpsError(output || err.message || 'nginx reload 执行失败')
  }
}
