import type { ApiResult } from '../../../utils/apiResult'

import { user } from '../../../models'
import { encrypt } from '../../../utils/cryptor'
import { verifyPassword } from '../../../utils/password'
import { HTTP_STATUS } from '../../../constants/httpStatus'

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

export async function loginFacade(
  input: LoginInput
): Promise<ApiResult<LoginData>> {
  const { username, password } = input

  if (typeof username !== 'string' || typeof password !== 'string') {
    return { ok: false, status: HTTP_STATUS.BAD_REQUEST, message: '参数异常' }
  }

  const trimmedUsername = username.trim()
  if (!trimmedUsername || !password) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '账号或密码不能为空'
    }
  }

  const record = await user.findUnique({ where: { username: trimmedUsername } })
  if (!record || !verifyPassword(password, record.password)) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      message: '账号或密码不正确'
    }
  }

  const token = encrypt({ id: record.id })
  return {
    ok: true,
    data: {
      token,
      user: {
        id: record.id,
        username: record.username,
        role: record.role
      }
    }
  }
}
