import { randomInt } from 'crypto'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

/**
 * 生成八位房间代码：前三位英文大写，后五位数字
 */
export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 3; i++) {
    code += LETTERS[randomInt(LETTERS.length)]
  }
  for (let i = 0; i < 5; i++) {
    code += DIGITS[randomInt(DIGITS.length)]
  }
  return code
}
