/* eslint-disable @typescript-eslint/no-use-before-define */
import { extname, resolve } from 'path'
import { startsWith, findLastIndex, compose, split, trim, filter, not, includes, inc, __ } from 'ramda'
import { stat, readdir, readFile, writeFile } from 'fs/promises'

function _formatStr(str: string) {
  const sentences = str.trim().split('\n')
  const getIndex = findLastIndex(startsWith('import '))
  const index = getIndex(sentences)

  const [imports, keepStill] = [
    sentences.slice(0, index + 1).filter(Boolean),
    sentences.slice(index + 1)
  ]

  const types = imports
    .filter(startsWith('import type '))
    .sort((a, b) => a.length - b.length)
  const packages = imports
    .filter((v) => v.match(/['"][a-zA-Z][^'"]*['"]$/))
    .sort((a, b) => a.length - b.length)

  const local = imports
    .filter((v) => !types.concat(packages).includes(v))
    .sort((a, b) => a.length - b.length)

  return types.concat('', packages, '', local, keepStill).join('\n')
}

function splitArrayByIndex(arr: string[], index: number) {
  return [arr.slice(0, index), arr.slice(index + 1)]
}
function sortByLength(str1: string, str2: string) {
  return str1.length - str2.length
}
/**
 * @description 将源文件所有的import语句分类并按照长度排序
 * @param str {string}
 * @returns {string}
 */
function formatStr(str: string): string {
  const getIndex = findLastIndex(startsWith('import'))
  const trimAndSplit = compose(split('\n'), trim)

  const lines = trimAndSplit(str)
  const [imports, others] = splitArrayByIndex(lines, getIndex(lines))

  const types = imports
    .filter(startsWith('import type '))
    .sort(sortByLength)

  const regToCatchAllPackages = (str: string) => str.match(/['"][a-zA-Z][^'"]*['"]$/)
  const packages = imports
    .filter(regToCatchAllPackages)
    .sort(sortByLength)

  const filterToCatchAllLocal = (types: string[], packages: string[]) => compose(not, includes(__, types.concat(packages)))
  const localImports = imports
    .filter(filterToCatchAllLocal(types, packages))
    .sort(sortByLength)


  return [types, packages, localImports, others].join('\n')
}


async function getAllTsFile(path = resolve(__dirname, '../src')) {
  async function helper(path: string) {
    const files = await readdir(path)

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const absolutePath = resolve(path, `./${file}`)
      const s = await stat(absolutePath)

      if (s.isFile() && ['.ts', '.tsx'].includes(extname(file))) {
        const fileContent = (await readFile(file)).toString()
        writeFile(absolutePath, formatStr(fileContent))
      } else if (s.isDirectory() && !file.startsWith('.')) {
        helper(absolutePath)
      }
    }
  }
  await helper(path)
}

async function formatImport() {
  getAllTsFile()
}
// async function reWriteFile() {
//   const files = await getAllTsFile()

//   files.forEach(
//     async (file) => {
//       const fileContent = await reWriteFile(file)
//     }
//   )
// }
formatImport()
