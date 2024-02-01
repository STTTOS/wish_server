import { AES, enc } from 'crypto-js'

import { secretKey } from '../config'

// const secretKey = 'test'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decrypt(data: string) {
  const bytes = AES.decrypt(data, secretKey)
  const decryptedData = bytes.toString(enc.Utf8)
  return decryptedData
}

export function encrypt(data: string) {
  return AES.encrypt(data, secretKey).toString()
}
