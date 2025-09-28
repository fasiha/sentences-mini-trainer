Assumes Supabase created with the following tables, both with row-level security:

```sql
create table public.memory (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  document_ident text not null,
  card_ident text not null,
  direction_ident text null,
  model jsonb not null,
  user_id uuid not null default auth.uid (),
  constraint memory_pkey primary key (id),
  constraint memory_document_ident_card_ident_direction_ident_user_id_key unique (
    user_id,
    document_ident,
    card_ident,
    direction_ident
  ),
  constraint memory_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;

create table public.reviews (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  document_ident text not null,
  result jsonb not null,
  user_id uuid not null default auth.uid (),
  card_ident text not null,
  direction_ident text null,
  constraint reviews_pkey primary key (id),
  constraint reviews_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;
```

For `public.memory` there's an index on one of the values of a JSONB column:
```sql
CREATE INDEX idx_memory_model_due_ms
ON public.memory
USING btree
  ((((model ->> 'dueMs'::text))::bigint))
WHERE (
  (model ? 'dueMs'::text)
  AND 
  (jsonb_typeof((model -> 'dueMs'::text)) = 'number'::text)
)
```

It also expects Supabase storage bucket `documents` containing a file `gloss-1k.json`, which is an array of objects, `{en: string, ja: string}[]`.

It also expects a Leitner update function as defined in [`leitner.sql`](./leitner.sql).
