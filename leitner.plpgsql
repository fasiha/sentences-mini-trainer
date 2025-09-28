CREATE OR REPLACE FUNCTION update_leiter_model(
    p_document_ident text,
    p_card_ident text,
    p_direction_ident text,
    p_is_correct integer -- only used on update (not insert)
)
RETURNS public.memory AS $$
DECLARE
    current_user_id uuid;
    current_ms bigint;
    existing_model jsonb;
    old_interval_ms bigint;
    old_due_ms bigint;
    new_interval_ms bigint;
    new_model jsonb;
    result_row public.memory;
BEGIN
    -- Get the user ID from the current session.
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RAISE EXCEPTION 'User not authenticated';
    END IF;

    current_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;

    -- Find the existing record for this user and card.
    SELECT model INTO existing_model
    FROM public.memory
    WHERE
        memory.user_id = current_user_id
        AND memory.document_ident = p_document_ident
        AND memory.card_ident = p_card_ident
        AND memory.direction_ident IS NOT DISTINCT FROM p_direction_ident;

    IF NOT FOUND THEN
        -- SCENARIO 1: No row exists, INSERT a new one.
        new_model := jsonb_build_object(
            'v', 0,
            'type', 'leitner',
            'intervalMs', 60000,
            'dueMs', current_ms + 60000
        );

        INSERT INTO public.memory (user_id, document_ident, card_ident, direction_ident, model)
        VALUES (current_user_id, p_document_ident, p_card_ident, p_direction_ident, new_model)
        RETURNING * INTO result_row; -- Capture the new row

    ELSE
        -- SCENARIO 2: A row exists, so validate and UPDATE it.

        -- Validate the model before proceeding.
        IF NOT (existing_model @> '{"v": 0, "type": "leitner"}'::jsonb) THEN
            RAISE EXCEPTION 'Cannot update a non-v0 Leitner model. Found: %', existing_model;
        END IF;

        -- (The rest of the update logic is the same as before)
        old_interval_ms := (existing_model->>'intervalMs')::bigint;
        old_due_ms := (existing_model->>'dueMs')::bigint;

        CASE p_is_correct
            WHEN 1 THEN -- Correct
                IF current_ms >= old_due_ms THEN
                    new_interval_ms := LEAST(7.884e9, (old_interval_ms * sqrt(2)))::bigint;
                ELSE
                    new_interval_ms := old_interval_ms;
                END IF;
            WHEN -1 THEN -- Incorrect
                new_interval_ms := GREATEST(60000, (old_interval_ms / sqrt(2)))::bigint;
            ELSE -- Handles 0 and any other unexpected values
                new_interval_ms := old_interval_ms;
        END CASE;

        -- Construct the new JSONB object
        new_model := jsonb_set(
            jsonb_set(existing_model, '{intervalMs}', to_jsonb(new_interval_ms)),
            '{dueMs}', to_jsonb(current_ms + new_interval_ms)
        );

        -- Perform the UPDATE
        UPDATE public.memory
        SET 
            model = new_model,
            modified_at = now()
        WHERE
            memory.user_id = current_user_id
            AND memory.document_ident = p_document_ident
            AND memory.card_ident = p_card_ident
            AND memory.direction_ident IS NOT DISTINCT FROM p_direction_ident
        RETURNING * INTO result_row; -- Capture the updated row

    END IF;
    RETURN result_row; -- Return the captured row
END;
$$ LANGUAGE plpgsql;