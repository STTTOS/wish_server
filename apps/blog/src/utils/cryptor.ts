/* eslint-disable no-console */
import fs from 'fs'
import crypto from 'crypto'

import { ivLength } from '@/config'

// 256位, 32个字符长度
const encryptionKey = process.env.IMAGE_SECRET_KEY

function encrypt(filePath: string) {
  // 128位
  const iv = crypto.randomBytes(ivLength)
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv)
  const encrypted = Buffer.concat([
    iv,
    cipher.update(fs.readFileSync(filePath)),
    cipher.final()
  ])
  return encrypted
}

// 解密函数
function decrypt(filePath: string) {
  const data = fs.readFileSync(filePath)
  const [iv, file] = [
    Uint8Array.prototype.slice.call(data, 0, ivLength),
    Uint8Array.prototype.slice.call(data, ivLength)
  ]

  // 使用 AES 解密算法和密码进行解密
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(encryptionKey),
    iv
  )
  const decryptedData = Buffer.concat([decipher.update(file), decipher.final()])
  return decryptedData
}

function encryptText(text: string) {
  const iv = crypto.randomBytes(ivLength)
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(text), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}
function decryptText(text: string) {
  const [iv, content] = text.split(':')

  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(encryptionKey),
    Buffer.from(iv, 'hex')
  )
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(content, 'hex')),
    decipher.final()
  ])
  return decrypted.toString()
}

export default {
  img: {
    encrypt,
    decrypt
  },
  text: {
    encrypt: encryptText,
    decrypt: decryptText
  }
}
