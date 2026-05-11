-- Core 已移除 `PostedBigBlind` 领域事件：`PostBigBlind` 与开局入座大盲均落为 `PostedJoiningBigBlinds`（`posts` 数组）。
-- 将历史磁带行就地改写，保证 `validatePersistedDomainEventRows` / 回放与新版 texas-poker-core 一致。

UPDATE `MatchDomainEvent`
SET
  `eventType` = 'PostedJoiningBigBlinds',
  `payload` = JSON_OBJECT(
    'handId',
    JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.handId')),
    'seq',
    JSON_EXTRACT(`payload`, '$.seq'),
    'posts',
    JSON_ARRAY(
      JSON_OBJECT(
        'userId',
        JSON_EXTRACT(`payload`, '$.userId'),
        'amount',
        JSON_EXTRACT(`payload`, '$.amount'),
        'requested',
        IFNULL(
          JSON_EXTRACT(`payload`, '$.requested'),
          JSON_EXTRACT(`payload`, '$.amount')
        )
      )
    )
  )
WHERE `eventType` = 'PostedBigBlind';
