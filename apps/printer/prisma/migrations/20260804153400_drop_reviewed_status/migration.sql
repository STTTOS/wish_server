-- Drop reviewed from PrintFileStatus.
-- Existing reviewed rows become new before enum rewrite.

UPDATE `PrintFile` SET `status` = 'new' WHERE `status` = 'reviewed';

ALTER TABLE `PrintFile` MODIFY COLUMN `status` ENUM('new', 'printed', 'print_failed') NOT NULL DEFAULT 'new';
