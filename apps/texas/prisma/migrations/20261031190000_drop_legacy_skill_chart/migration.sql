-- Drop legacy L1–L4 skill cache + hole-card chart counters (tech → PlayerTechStat).
ALTER TABLE `player_style_stat`
  DROP COLUMN `chartOkVpipHands`,
  DROP COLUMN `chartKnownVpipHands`,
  DROP COLUMN `skillScore`,
  DROP COLUMN `skillL1`,
  DROP COLUMN `skillL2`,
  DROP COLUMN `skillL3`,
  DROP COLUMN `skillL4`;

ALTER TABLE `style_population_stat`
  DROP COLUMN `skillEligibleUsers`,
  DROP COLUMN `skillScoreSum`,
  DROP COLUMN `avgSkill`;
