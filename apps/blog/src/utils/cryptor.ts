import { AES, enc } from 'crypto-js'

const { SECRET_KEY } = process.env
export function decrypt(data: string) {
  const bytes = AES.decrypt(data, SECRET_KEY!)
  const decryptedData = bytes.toString(enc.Utf8)
  return decryptedData
}

export function encrypt(data: string) {
  return AES.encrypt(data, SECRET_KEY!).toString()
}
