-- RenameIndex
ALTER TABLE `asset_usage_event` RENAME INDEX `asset_usage_event_asset_type_asset_id_server_ts_idx` TO `asset_usage_event_assetType_assetId_server_ts_idx`;

-- RenameIndex
ALTER TABLE `asset_usage_event` RENAME INDEX `asset_usage_event_user_id_server_ts_idx` TO `asset_usage_event_userId_server_ts_idx`;
