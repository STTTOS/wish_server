import prisma from '../models'

export const roadRepository = {
  list() {
    return prisma.road.findMany({
      orderBy: [{ sort: 'asc' }, { name: 'asc' }]
    })
  },

  findById(id: number) {
    return prisma.road.findUnique({ where: { id } })
  },

  findByName(name: string) {
    return prisma.road.findUnique({ where: { name } })
  },

  create(data: { name: string; sort?: number }) {
    return prisma.road.create({
      data: {
        name: data.name,
        sort: data.sort ?? 0
      }
    })
  },

  update(id: number, data: { name?: string; sort?: number }) {
    return prisma.road.update({
      where: { id },
      data
    })
  },

  delete(id: number) {
    return prisma.road.delete({ where: { id } })
  },

  countSignsByRoadName(roadName: string) {
    return prisma.roadSign.count({ where: { roadName } })
  },

  renameSignsRoad(from: string, to: string) {
    return prisma.roadSign.updateMany({
      where: { roadName: from },
      data: { roadName: to }
    })
  }
}
