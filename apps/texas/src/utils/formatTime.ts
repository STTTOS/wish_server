import dayjs from 'dayjs'

import { timeFormat } from '../config'

const formatTime = (time?: string | Date | null) => {
  if (!time) return null
  return dayjs(time).format(timeFormat)
}
export default formatTime
