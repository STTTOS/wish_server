import { category } from '../models'

const notDeleted = { deletedAt: null } as const

/** Repository：品类持久化（软删除约定集中在此） */
export const categoryRepository = {
  listActive() {
    return category.findMany({
      where: notDeleted,
      orderBy: [{ id: 'asc' }]
    })
  },

  findActiveById(id: number) {
    return category.findFirst({
      where: { id, ...notDeleted }
    })
  },

  findActiveByName(name: string, excludeId?: number) {
    return category.findFirst({
      where: {
        name,
        ...notDeleted,
        ...(excludeId !== undefined ? { NOT: { id: excludeId } } : {})
      }
    })
  },

  create(name: string) {
    return category.create({ data: { name } })
  },

  updateName(id: number, name: string) {
    return category.update({
      where: { id },
      data: { name }
    })
  },

  softDelete(id: number) {
    return category.update({
      where: { id },
      data: { deletedAt: new Date() }
    })
  },

  /** 保证默认品类存在；若曾软删除则恢复 */
  ensureByName(name: string) {
    return category.upsert({
      where: { name },
      create: { name },
      update: { deletedAt: null }
    })
  }
}
