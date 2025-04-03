-- AlterTable
ALTER TABLE `Record` MODIFY `action` ENUM('check', 'fold', 'bet', 'raise', 'allIn', 'call') NOT NULL;
