import type { ApiResult } from '../../../utils/apiResult'

import { encrypt } from '../../../utils/cryptor'
import { ok, fail } from '../../../utils/apiResult'
import { verifyPassword } from '../../../utils/password'
import { HTTP_STATUS } from '../../../constants/httpStatus'
import { userRepository } from '../../../repositories/userRepository'

export type LoginInput = {
  username: unknown
  password: unknown
}

export type LoginData = {
  token: string
  user: {
    id: number
    username: string
    role: 'admin' | 'staff'
  }
}

function validateLoginCredentials(
  input: LoginInput
): ApiResult<{ username: string; password: string }> {
  if (
    typeof input.username !== 'string' ||
    typeof input.password !== 'string'
  ) {
    return fail(HTTP_STATUS.BAD_REQUEST, '参数异常')
  }

  const username = input.username.trim()
  if (!username || !input.password) {
    return fail(HTTP_STATUS.BAD_REQUEST, '账号或密码不能为空')
  }

  return ok({ username, password: input.password })
}

export async function loginFacade(
  input: LoginInput
): Promise<ApiResult<LoginData>> {
  const credentials = validateLoginCredentials(input)
  if (!credentials.ok) return credentials

  const record = await userRepository.findByUsername(credentials.data.username)
  if (!record || !verifyPassword(credentials.data.password, record.password)) {
    return fail(HTTP_STATUS.BAD_REQUEST, '账号或密码不正确')
  }

  return ok({
    token: encrypt({ id: record.id }),
    user: {
      id: record.id,
      username: record.username,
      role: record.role
    }
  })
}
