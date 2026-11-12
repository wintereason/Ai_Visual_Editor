-- Visual Creator: asset ids belong to an owner (Phase 1 stabilization).
--
-- THE PROBLEM
--   An asset's id is derived from the file's content: "asset_" + the first 24 hex characters of its hash. Two accounts that upload the same
--   picture therefore produce the SAME id. The table's primary key was the id alone, so the second account's upload collided with the first
--   account's row (duplicate key) and that account ended up with no copy of the picture.
--
-- THE FIX
--   Make the key (owner_id, id): each account holds its own row for the same picture. Everything else is unchanged:
--   row-level security is still by owner_id, unique (owner_id, hash) still allows one row per picture per account, the storage key still lives
--   inside the owner's own folder, and the sharing policy still lets members read the pictures a shared project uses.
--   Nothing in the database references assets(id) as a foreign key (derived_from_asset is a plain text column), so no other table changes.
--
-- SAFETY
--   * Existing rows are kept as they are. The new key is strictly weaker than the old one (it allows more), so existing data always satisfies it.
--   * Safe to run more than once.
--   * The table is small and the change takes a brief lock; run it when nobody is uploading.
--   * Apply this BEFORE or AFTER deploying the new editor code: the code works with either (it falls back to the old behaviour until this runs).
--
-- ROLLBACK (only if no two accounts hold the same id; if they do, delete the extra rows first, keeping the oldest)
--   alter table public.assets drop constraint assets_pkey;
--   alter table public.assets add constraint assets_pkey primary key (id);
--   drop index if exists public.assets_id_idx;

alter table public.assets drop constraint if exists assets_pkey;
alter table public.assets add constraint assets_pkey primary key (owner_id, id);

-- Looking a picture up by id alone (the sharing policy and the editor's download lookup do this) must stay fast.
create index if not exists assets_id_idx on public.assets (id);
