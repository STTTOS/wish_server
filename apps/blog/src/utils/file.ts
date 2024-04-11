import { stat, readdir } from 'fs/promises'
import { join, extname, basename } from 'path'

import { fileNameSpliter } from '../config'

export interface GetAllFilesOptions {
  /**排除哪些文件 */
  exclude?: string[]
  /*包含的文件名后缀 */
  include?: string[]
  /**是否只返回文件名 */
  onlyFileName?: boolean
}
/*
@description 读取文件夹下所有文件绝对路径
@param entry 入口路径(绝对路径)
@param options 配置参数
*/
export async function getAllFiles(entry: string, options?: GetAllFilesOptions) {
  const result: string[] = []
  await helper(entry)
  return result
  async function helper(_entry: string) {
    const { exclude, include, onlyFileName } = options || {}
    const files = await readdir(_entry)

    for (const file of files) {
      // 排除隐藏文件夹 以及 指定要排除的文件名
      if (file.startsWith('.') || exclude?.includes(file)) continue

      // 构造文件或文件夹的完整路径
      const filePath = join(_entry, file)
      const fileStat = await stat(filePath)
      if (fileStat.isFile()) {
        if (include && include.includes(extname(file))) continue

        result.push(onlyFileName ? file : filePath)
      } else if (fileStat.isDirectory()) {
        await helper(filePath)
      }
    }
  }
}

export const getFileName = (name: string) => basename(name, extname(name))

export default function getOriginFileMeta(filename: string) {
  const splitIndex = filename.lastIndexOf(fileNameSpliter)
  const originName = filename.includes(fileNameSpliter)
    ? filename.slice(0, splitIndex)
    : getFileName(filename)
  const ext = extname(filename)

  return {
    ext,
    originName,
    name: `${originName}${ext}`
  }
}
