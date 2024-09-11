import { logger } from '@/logger'
import { user, eBook, moment, article, timeline, momentImages } from '@/models'

function replaceDomain(input: string) {
  return input.replaceAll(
    /https:\/\/xuan-1313104191.cos.ap-chengdu.myqcloud.com/g,
    'https://cos.wishufree.com'
  )
}

async function mapArticleUrl() {
  logger.info('替换article static cos domain...')
  const lists = await article.findMany()
  for (const list of lists) {
    await article.update({
      where: { id: list.id },
      data: {
        content: replaceDomain(list.content),
        backgroundUrl: list.backgroundUrl
          ? replaceDomain(list.backgroundUrl)
          : null
      }
    })
    logger.info(`成功修改article id ${list.id} cos domain`)
  }
  logger.info('article static cos domain replaced')
}

async function mapUserUrl() {
  logger.info('替换user static cos domain...')
  const lists = await user.findMany()
  for (const list of lists) {
    await user.update({
      where: { id: list.id },
      data: {
        avatar: list.avatar ? replaceDomain(list.avatar) : null,
        backgroundUrl: list.backgroundUrl
          ? replaceDomain(list.backgroundUrl)
          : null
      }
    })
    logger.info(`成功修改user id ${list.id} cos domain`)
  }
  logger.info('user static cos domain replaced')
}
async function mapMomentUrl() {
  logger.info('替换moment static cos domain...')
  const lists = await moment.findMany()
  for (const list of lists) {
    await moment.update({
      where: { id: list.id },
      data: {
        content: list.content ? replaceDomain(list.content) : null,
        cover: list.cover ? replaceDomain(list.cover) : null
      }
    })
    logger.info(`成功修改moment id ${list.id} cos domain`)
  }
  logger.info('moment static cos domain replaced')
}

async function mapMomentImagesUrl() {
  logger.info('替换momentImages static cos domain...')
  const lists = await momentImages.findMany()
  for (const list of lists) {
    await momentImages.update({
      where: { id: list.id },
      data: {
        src: replaceDomain(list.src)
      }
    })
    logger.info(`成功修改momentImages id ${list.id} cos domain`)
  }
  logger.info('momentImages static cos domain replaced')
}

async function mapEbooksUrl() {
  logger.info('替换eBook static cos domain...')
  const lists = await eBook.findMany()
  for (const list of lists) {
    await eBook.update({
      where: { id: list.id },
      data: {
        eBookUrl: replaceDomain(list.eBookUrl)
      }
    })
    logger.info(`成功修改eBook id ${list.id} cos domain`)
  }
  logger.info('eBook static cos domain replaced')
}

async function mapTimelineUrl() {
  logger.info('替换timeline static cos domain...')
  const lists = await timeline.findMany()
  for (const list of lists) {
    await timeline.update({
      where: { id: list.id },
      data: {
        cover: list.cover ? replaceDomain(list.cover) : null
      }
    })
    logger.info(`成功修改timeline id ${list.id} cos domain`)
  }
  logger.info('timeline static cos domain replaced')
}
mapArticleUrl()
mapUserUrl()
mapMomentUrl()
mapMomentImagesUrl()
mapEbooksUrl()
mapTimelineUrl()
