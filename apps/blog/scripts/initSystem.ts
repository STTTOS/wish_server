/* eslint-disable no-console */
import fs from 'fs'
import { join } from 'path'
import { access } from 'fs/promises'

async function createFiles() {
  await access('./static').catch(() => {
    fs.mkdirSync(join(__dirname, '../static/origin'), { recursive: true })
  })
  await access('../system.json').catch(() => {
    fs.writeFileSync(join(__dirname, '../system.json'), '{ "viewCount": 0 }', {
      encoding: 'utf-8'
    })
  })
}

console.log('初始化系统中...')
createFiles().then(() => {
  console.log('初始化系统完成')
})
