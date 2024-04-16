import fs from 'fs'
import { join } from 'path'
import { access, readFile, writeFile } from 'fs/promises'
import { map, trim, head, split, filter, compose } from 'ramda'

import { logger } from '../logger'

async function initSystem() {
  logger.info('初始化系统中...')
  await Promise.allSettled([
    access(join(__dirname, '../../public')).catch(() => {
      fs.mkdirSync(join(__dirname, '../../public'))
    }),
    access(join(__dirname, './static')).catch(() => {
      fs.mkdirSync(join(__dirname, '../../static/origin'), { recursive: true })
      fs.mkdirSync(join(__dirname, '../../static/files'), { recursive: true })
      fs.mkdirSync(join(__dirname, '../../static/temp'), { recursive: true })
    }),
    access(join(__dirname, '../system.json')).catch(() => {
      fs.writeFileSync(
        join(__dirname, '../system.json'),
        '{ "viewCount": 0 }',
        {
          encoding: 'utf-8'
        }
      )
    }),
    createEnvDeclaration()
  ])
  logger.info('初始化系统完成')
}
/**
 * @description 从.env环境中生成.d.ts声明文件
 */
async function createEnvDeclaration() {
  const dotEnvPath = join(__dirname, '../../.env')
  try {
    await access(dotEnvPath)
    const envsSource = await readFile(dotEnvPath, { encoding: 'utf-8' })

    const filterEmptyAndAnnotation = (input: string) =>
      !!input && !input.trimStart().startsWith('#')

    const getEnvKeys = compose(
      map(compose(trim, head, split('='))),
      filter(filterEmptyAndAnnotation),
      split('\n')
    )
    const keys = getEnvKeys(envsSource)

    const interfaceContent = keys
      .map((key) => {
        return `${key}: string`
      })
      .join('\n\t\t')
    await writeFile(
      join(__dirname, '../../global.env.d.ts'),
      `declare namespace NodeJS {
  interface ProcessEnv {
    ${interfaceContent}
  }
}
`
    )
  } catch (error) {
    logger.error((error as Error).message)
  }
}

initSystem()
