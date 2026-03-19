-- Add isAdmin field for admin-only operations
ALTER TABLE `User`
  ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false;

