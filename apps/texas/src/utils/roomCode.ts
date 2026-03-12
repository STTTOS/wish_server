const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

/**
 * 生成八位房间代码：前三位英文大写，后五位数字
 */
export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 3; i++) {
    code += LETTERS[Math.floor(Math.random() * LETTERS.length)]
  }
  for (let i = 0; i < 5; i++) {
    code += DIGITS[Math.floor(Math.random() * DIGITS.length)]
  }
  return code
}
