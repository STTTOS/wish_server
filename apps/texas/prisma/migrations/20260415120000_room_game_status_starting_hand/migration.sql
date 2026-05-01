-- AlterTable: full `Room.gameStatus` enum including `starting_hand`.
-- Historical migrations never added this column; shadow DB replay needs ADD.
-- Existing databases that already have the column get MODIFY (enum widen / align).
SET @preparedStatement = (
  SELECT IF(
    (
      SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Room'
        AND COLUMN_NAME = 'gameStatus'
    ) > 0,
    'ALTER TABLE `Room` MODIFY COLUMN `gameStatus` ENUM(''waiting'',''entering'',''starting_hand'',''in_hand'',''between_hands'') NOT NULL DEFAULT ''waiting''',
    'ALTER TABLE `Room` ADD COLUMN `gameStatus` ENUM(''waiting'',''entering'',''starting_hand'',''in_hand'',''between_hands'') NOT NULL DEFAULT ''waiting'''
  )
);
PREPARE alterRoomGameStatusIfNeeded FROM @preparedStatement;
EXECUTE alterRoomGameStatusIfNeeded;
DEALLOCATE PREPARE alterRoomGameStatusIfNeeded;
