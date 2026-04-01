-- Match.startedAt 改为可空；创建行时不填，角色分配后再写入
ALTER TABLE `Match` MODIFY `startedAt` DATETIME(3) NULL;
