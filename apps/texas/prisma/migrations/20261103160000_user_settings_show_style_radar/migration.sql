-- 数据雷达隐私开关：默认关闭（仅本人可见；开启后他人可见）
ALTER TABLE `UserSettings`
  ADD COLUMN `showStyleRadar` BOOLEAN NOT NULL DEFAULT false;
