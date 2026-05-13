ALTER TABLE `User`
  ADD COLUMN `hasSetName` BOOLEAN NOT NULL DEFAULT false;

-- 存量用户视为已设置过昵称
UPDATE `User` SET `hasSetName` = true;
