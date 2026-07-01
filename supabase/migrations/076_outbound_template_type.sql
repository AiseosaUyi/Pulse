-- 076: add template_type to outbound_templates
-- Scenario-driven template types for the full outreach sequence.

alter table outbound_templates
  add column if not exists template_type text not null default 'cold_open'
    check (template_type in (
      'cold_open',
      'follow_up_1',
      'follow_up_2',
      'post_event',
      'event_confirmed',
      'promised_reminder',
      're_engagement',
      'value_add',
      'objection_response'
    ));

comment on column outbound_templates.template_type is
  'Outreach scenario: cold_open | follow_up_1 | follow_up_2 | post_event | event_confirmed | promised_reminder | re_engagement | value_add | objection_response';
