import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/** 当前中国标准时区日历日 `YYYY-MM-DD`（用于 `fortuneOn`）。民间称「北京时间」；IANA 标识为 `Asia/Shanghai`（全国同一东八区，非特指上海经度）。 */
export function beijingFortuneOn(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')
}
