declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string
    SECRET_KEY: string
    COS_SECRET_KEY: string
    COS_SECRET_ID: string
    IMAGE_SECRET_KEY: string
  }
}
