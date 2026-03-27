/**
 * Redis keys 集中管理，避免散落硬编码。
 */
export const REDIS_KEY_LOGIN_SESSION = (scope: string, userId: number) =>
  `texas:login:session:${scope}:${userId}`
