import { PrismaClient } from '@prisma/printer-client'

const prisma = new PrismaClient()

export const { user, printFile } = prisma

export default prisma
