import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/** 当前「北京」日历日 `YYYY-MM-DD`（用于 `fortuneOn`；与服务器其它时间格式化一致使用 dayjs） */
export function beijingFortuneOn(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD')
}
