-- 去重：同一 matchId+userId 仅保留 id 最小的一行
DELETE p1 FROM `PlayerMatchRecord` p1
INNER JOIN `PlayerMatchRecord` p2
  ON p1.`matchId` = p2.`matchId`
  AND p1.`userId` = p2.`userId`
  AND p1.`id` > p2.`id`;

-- CreateIndex
CREATE UNIQUE INDEX `PlayerMatchRecord_matchId_userId_key` ON `PlayerMatchRecord`(`matchId`, `userId`);
