import { join } from 'path'
import { access, readFile, writeFile } from 'fs/promises'
import { map, trim, head, split, filter, compose } from 'ramda'

import { logger } from '../logger'

/**
 * @description 从.env环境中生成.d.ts声明文件
 */
async function generateDelcaration() {
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
      .join(`\n${' '.repeat(4)}`)
    await writeFile(
      join(__dirname, '../../global.env.d.ts'),
      `declare namespace NodeJS {
  interface ProcessEnv {
    ${interfaceContent}
  }
}
`
    )
    logger.info('根据.env生成声明文件')
  } catch (error) {
    logger.error((error as Error).message)
  }
}

export default generateDelcaration
