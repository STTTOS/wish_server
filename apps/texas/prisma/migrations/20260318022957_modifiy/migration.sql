-- User: avatar -> avatarUrl (可选) + avatarKey 默认 cartoon/default，保留原头像 URL

ALTER TABLE `User` ADD COLUMN `avatarUrl` VARCHAR(191) NULL;
ALTER TABLE `User` ADD COLUMN `avatarKey` VARCHAR(191) NOT NULL DEFAULT 'cartoon/default';

UPDATE `User` SET `avatarUrl` = `avatar` WHERE `avatar` IS NOT NULL AND `avatar` != '';

ALTER TABLE `User` DROP COLUMN `avatar`;
