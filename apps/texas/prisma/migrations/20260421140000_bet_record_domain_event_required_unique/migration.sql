-- Backfill nullable domain event keys on historical rows.
UPDATE `BetRecord`
SET `domainHandId` = CONCAT('legacy_', IFNULL(`matchId`, 0), '_', `id`)
WHERE `domainHandId` IS NULL;

UPDATE `BetRecord`
SET `domainEventSeq` = `id`
WHERE `domainEventSeq` IS NULL;

-- Defensive dedupe before adding unique constraint.
DELETE b1
FROM `BetRecord` b1
INNER JOIN `BetRecord` b2
  ON b1.`matchId` = b2.`matchId`
 AND b1.`domainHandId` = b2.`domainHandId`
 AND b1.`domainEventSeq` = b2.`domainEventSeq`
 AND b1.`userId` = b2.`userId`
 AND b1.`id` > b2.`id`;

ALTER TABLE `BetRecord`
  MODIFY `domainHandId` VARCHAR(191) NOT NULL,
  MODIFY `domainEventSeq` INTEGER NOT NULL;

CREATE UNIQUE INDEX `BetRecord_matchId_domainHandId_domainEventSeq_userId_key`
  ON `BetRecord`(`matchId`, `domainHandId`, `domainEventSeq`, `userId`);
