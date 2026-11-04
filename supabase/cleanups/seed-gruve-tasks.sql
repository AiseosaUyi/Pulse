-- Seed team_people and tasks for Gruve tenant (Section 10 of Pulse Tasks spec)

do $$
declare
  v_tenant text := 'gruve';
  v_creator uuid := 'e2e34d7e-828c-4edc-8209-f0c068453662'; -- Aise
  v_today date := current_date;

  v_olamide_id uuid;
  v_abas_id uuid;
  v_abdul_id uuid;
  v_aise_id uuid;
  v_oki_id uuid;

  v_task_id uuid;
begin
  -- 1. team_people
  insert into team_people (tenant_slug, name, user_id, active)
  values (v_tenant, 'Olamide', 'c776f5c0-ab6f-4783-9611-803a760ad75b', true)
  on conflict do nothing;

  insert into team_people (tenant_slug, name, user_id, active)
  values (v_tenant, 'Abas', 'bf83db6b-86ba-4d5a-8f3a-742eb13dd81c', true)
  on conflict do nothing;

  insert into team_people (tenant_slug, name, user_id, active)
  values (v_tenant, 'Abdul', '4ba907de-8329-4c0a-923e-81adf6ef6542', true)
  on conflict do nothing;

  insert into team_people (tenant_slug, name, user_id, active)
  values (v_tenant, 'Aise', 'e2e34d7e-828c-4edc-8209-f0c068453662', true)
  on conflict do nothing;

  insert into team_people (tenant_slug, name, user_id, active)
  values (v_tenant, 'Oki', null, true)
  on conflict do nothing;

  select id into v_olamide_id from team_people where tenant_slug = v_tenant and name = 'Olamide' limit 1;
  select id into v_abas_id from team_people where tenant_slug = v_tenant and name = 'Abas' limit 1;
  select id into v_abdul_id from team_people where tenant_slug = v_tenant and name = 'Abdul' limit 1;
  select id into v_aise_id from team_people where tenant_slug = v_tenant and name = 'Aise' limit 1;
  select id into v_oki_id from team_people where tenant_slug = v_tenant and name = 'Oki' limit 1;

  -- 2. Olamide Tasks
  -- Daily post on Gruve Lagos
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, proof_required, proof_hint, metric_label, tags)
  values (v_tenant, 'Daily post on Gruve Lagos', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'daily', 'link', 'Paste the Discord #gruve-daily message link', 'Followers gained', array['social'])
  returning id into v_task_id;

  if v_task_id is not null then
    insert into task_checklist_items (tenant_slug, task_id, position, label) values
      (v_tenant, v_task_id, 1, 'Posted on @gruve_official'),
      (v_tenant, v_task_id, 2, 'Collab invite sent to the organiser (if it''s an event post)'),
      (v_tenant, v_task_id, 3, 'Shared in Discord with yesterday''s views and follows');
  end if;

  -- This week in Lagos slides
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, proof_required, tags)
  values (v_tenant, 'This week in Lagos slides', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[1]::smallint[], 'link', array['social']);

  -- Area reel
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, proof_required, tags)
  values (v_tenant, 'Area reel', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[3]::smallint[], 'link', array['social', 'video']);

  -- Don't be bored this weekend roundup
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, proof_required, tags)
  values (v_tenant, 'Don''t be bored this weekend roundup', v_olamide_id, v_creator, 'high', 'recurring', v_today, 'weekly', array[4]::smallint[], 'link', array['social']);

  -- Event reel shot at an event
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, proof_required, tags)
  values (v_tenant, 'Event reel shot at an event', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[6]::smallint[], 'link', array['social', 'video']);

  -- Reply to all comments
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, proof_required, tags)
  values (v_tenant, 'Reply to all comments', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'daily', 'none', array['social', 'engagement']);

  -- 3. Abas Tasks
  -- Clear Pulse Today and the IG inbox
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, proof_required, proof_hint, tags)
  values (v_tenant, 'Clear Pulse Today and the IG inbox', v_abas_id, v_creator, 'normal', 'recurring', v_today, 'daily', 'note', 'Who did you reply to', array['inbox', 'support']);

  -- Ambassador outreach check-in
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, proof_required, metric_label, tags)
  values (v_tenant, 'Ambassador outreach check-in', v_abas_id, v_creator, 'normal', 'recurring', v_today, 'weekdays', 'none', 'DMs sent by ambassadors', array['ambassadors']);

  -- 4. Abdul Tasks
  -- Send outreach from Pulse Pipeline
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, proof_required, metric_label, metric_target, tags)
  values (v_tenant, 'Send outreach from Pulse Pipeline', v_abdul_id, v_creator, 'normal', 'recurring', v_today, 'weekdays', 'none', 'First messages sent', 10, array['outreach', 'pipeline']);

  -- Chase list
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, proof_required, tags)
  values (v_tenant, 'Chase list', v_abdul_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[1,4]::smallint[], 'note', array['outreach']);

  -- 5. Everyone: Friday standup numbers ready
  insert into tasks (tenant_slug, title, owner_person_id, created_by, priority, kind, start_date, recurrence, recurrence_days, due_time, proof_required, tags)
  values
    (v_tenant, 'Friday standup numbers ready', v_olamide_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[5]::smallint[], '10:00:00', 'note', array['standup']),
    (v_tenant, 'Friday standup numbers ready', v_abas_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[5]::smallint[], '10:00:00', 'note', array['standup']),
    (v_tenant, 'Friday standup numbers ready', v_abdul_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[5]::smallint[], '10:00:00', 'note', array['standup']),
    (v_tenant, 'Friday standup numbers ready', v_aise_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[5]::smallint[], '10:00:00', 'note', array['standup']),
    (v_tenant, 'Friday standup numbers ready', v_oki_id, v_creator, 'normal', 'recurring', v_today, 'weekly', array[5]::smallint[], '10:00:00', 'note', array['standup']);

end $$;
