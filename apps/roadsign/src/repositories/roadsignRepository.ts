import type { Prisma } from '@prisma/roadsign-client'
import type {
  RoadSignListQuery,
  RoadSignWriteData,
  RoadSignUpdateData
} from '../router/roadsign/services/roadsignValidator'

import { Prisma as PrismaNS } from '@prisma/roadsign-client'

import prisma from '../models'

function toPhotoJson(photo: RoadSignWriteData['signPhoto']) {
  if (!photo) return PrismaNS.JsonNull
  return {
    id: photo.id,
    kind: photo.kind,
    url: photo.url,
    originalUrl: photo.originalUrl,
    ...(photo.name ? { name: photo.name } : {})
  } satisfies Prisma.InputJsonValue
}

function toExtraPhotosJson(photos: RoadSignWriteData['extraPhotos']) {
  return photos.map((photo) => ({
    id: photo.id,
    kind: photo.kind,
    url: photo.url,
    originalUrl: photo.originalUrl,
    ...(photo.name ? { name: photo.name } : {})
  })) satisfies Prisma.InputJsonValue
}

function toWriteInput(data: RoadSignWriteData) {
  return {
    name: data.name,
    description: data.description,
    extra: data.extra,
    type: data.type,
    status: data.status,
    direction: data.direction,
    level: data.level,
    lng: data.lng,
    lat: data.lat,
    signPhoto: toPhotoJson(data.signPhoto),
    extraPhotos: toExtraPhotosJson(data.extraPhotos)
  }
}

export const roadsignRepository = {
  async list(query: RoadSignListQuery) {
    const where: Prisma.RoadSignWhereInput = {}
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword } },
        { description: { contains: query.keyword } },
        { extra: { contains: query.keyword } }
      ]
    }
    if (query.statuses.length === 1) {
      where.status = query.statuses[0]
    } else if (query.statuses.length > 1) {
      where.status = { in: query.statuses }
    }
    if (query.type) where.type = query.type
    if (query.direction) where.direction = query.direction
    if (query.level) where.level = query.level

    const [total, list] = await Promise.all([
      prisma.roadSign.count({ where }),
      prisma.roadSign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      })
    ])

    return { total, list }
  },

  findById(id: number) {
    return prisma.roadSign.findUnique({ where: { id } })
  },

  create(data: RoadSignWriteData) {
    return prisma.roadSign.create({ data: toWriteInput(data) })
  },

  update(data: RoadSignUpdateData) {
    const { id, ...rest } = data
    return prisma.roadSign.update({
      where: { id },
      data: toWriteInput(rest)
    })
  },

  delete(id: number) {
    return prisma.roadSign.delete({ where: { id } })
  }
}
