// global-env.d.ts
declare namespace NodeJS {
  interface ProcessEnv {
    /**数据库链接url */
    DATABASE_URL: string
    /**token加密米哦啊 */
    SECRET_KEY: string
    /**腾讯cos秘钥key */
    COS_SECRET_KEY: string
    /**腾讯cos秘钥id */
    COS_SECRET_ID: string
  }
}
