import type { DisciplineProvider } from './types'

import { disciplineRulesProvider } from './disciplineRulesProvider'

export type { DisciplineProvider, DisciplineEvaluation } from './types'
export { disciplineRulesProvider } from './disciplineRulesProvider'

let activeProvider: DisciplineProvider = disciplineRulesProvider

export const getActiveDisciplineProvider = (): DisciplineProvider =>
  activeProvider

export const setActiveDisciplineProvider = (provider: DisciplineProvider) => {
  activeProvider = provider
}

export const resetActiveDisciplineProvider = () => {
  activeProvider = disciplineRulesProvider
}
