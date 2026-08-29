alter table upload_sessions
  drop constraint upload_sessions_target_file_id_fkey,
  add constraint upload_sessions_target_file_id_fkey
    foreign key (target_file_id) references file_entries(id) on delete set null;

alter table upload_sessions
  drop constraint upload_sessions_completed_version_id_fkey,
  add constraint upload_sessions_completed_version_id_fkey
    foreign key (completed_version_id) references file_versions(id) on delete set null;
